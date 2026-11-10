use regex::Regex;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DecodedTurn {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub model_name: Option<String>,
}

static MODEL_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_model_regex() -> &'static Regex {
    MODEL_REGEX.get_or_init(|| {
        Regex::new(r"(gemini-[a-zA-Z0-9\.\-_]+|claude-[a-zA-Z0-9\.\-_]+|gpt-[a-zA-Z0-9\.\-_]+)").unwrap()
    })
}

/// Decodes the protobuf blob in `gen_metadata.data`.
/// Structure:
/// Root message -> Field 1 (len) -> Field 4 (len) ->
///   Field 2 (varint) = input_tokens
///   Field 3 (varint) = output_tokens
///   Field 5 (varint) = cache_read_tokens
pub fn decode_gen_metadata(data: &[u8]) -> Option<DecodedTurn> {
    if data.is_empty() {
        return None;
    }

    let mut turn = DecodedTurn::default();
    let mut found_tokens = false;

    // 1. Scan for model name using regex over byte slice
    if let Ok(text) = std::str::from_utf8(data) {
        if let Some(m) = get_model_regex().find(text) {
            turn.model_name = Some(m.as_str().to_string());
        }
    } else {
        // Fallback for non-utf8 whole buffer: lossy conversion
        let text = String::from_utf8_lossy(data);
        if let Some(m) = get_model_regex().find(&text) {
            turn.model_name = Some(m.as_str().to_string());
        }
    }

    // 2. Decode Field 1 -> Field 4
    let mut i = 0;
    while i < data.len() {
        let tag = data[i];
        i += 1;
        let wire = tag & 0x07;
        let fnum = tag >> 3;

        match wire {
            0 => {
                while i < data.len() && (data[i] & 0x80) != 0 {
                    i += 1;
                }
                i += 1;
            }
            2 => {
                let mut len: usize = 0;
                let mut shift = 0;
                while i < data.len() {
                    let b = data[i];
                    i += 1;
                    len |= ((b & 0x7f) as usize) << shift;
                    shift += 7;
                    if (b & 0x80) == 0 {
                        break;
                    }
                }
                if i + len > data.len() {
                    break;
                }
                let sub = &data[i..i + len];
                i += len;

                if fnum == 1 {
                    // Inside Field 1, look for Field 4
                    let mut j = 0;
                    while j < sub.len() {
                        let tag4 = sub[j];
                        j += 1;
                        let wire4 = tag4 & 0x07;
                        let fnum4 = tag4 >> 3;

                        match wire4 {
                            0 => {
                                while j < sub.len() && (sub[j] & 0x80) != 0 {
                                    j += 1;
                                }
                                j += 1;
                            }
                            2 => {
                                let mut len4: usize = 0;
                                let mut shift4 = 0;
                                while j < sub.len() {
                                    let b = sub[j];
                                    j += 1;
                                    len4 |= ((b & 0x7f) as usize) << shift4;
                                    shift4 += 7;
                                    if (b & 0x80) == 0 {
                                        break;
                                    }
                                }
                                if j + len4 > sub.len() {
                                    break;
                                }
                                let msg4 = &sub[j..j + len4];
                                j += len4;

                                if fnum4 == 4 {
                                    // Parse fields inside Field 4
                                    let mut k = 0;
                                    while k < msg4.len() {
                                        let tagk = msg4[k];
                                        k += 1;
                                        let wirek = tagk & 0x07;
                                        let fnumk = tagk >> 3;

                                        match wirek {
                                            0 => {
                                                let mut val: u64 = 0;
                                                let mut shiftk = 0;
                                                while k < msg4.len() {
                                                    let b = msg4[k];
                                                    k += 1;
                                                    val |= ((b & 0x7f) as u64) << shiftk;
                                                    shiftk += 7;
                                                    if (b & 0x80) == 0 {
                                                        break;
                                                    }
                                                }
                                                match fnumk {
                                                    2 => {
                                                        turn.input_tokens = val;
                                                        found_tokens = true;
                                                    }
                                                    3 => {
                                                        turn.output_tokens = val;
                                                        found_tokens = true;
                                                    }
                                                    5 => {
                                                        turn.cache_read_tokens = val;
                                                    }
                                                    _ => {}
                                                }
                                            }
                                            2 => {
                                                let mut lk: usize = 0;
                                                let mut sk = 0;
                                                while k < msg4.len() {
                                                    let b = msg4[k];
                                                    k += 1;
                                                    lk |= ((b & 0x7f) as usize) << sk;
                                                    sk += 7;
                                                    if (b & 0x80) == 0 {
                                                        break;
                                                    }
                                                }
                                                k += lk;
                                            }
                                            1 => k += 8,
                                            5 => k += 4,
                                            _ => break,
                                        }
                                    }
                                }
                            }
                            1 => j += 8,
                            5 => j += 4,
                            _ => break,
                        }
                    }
                }
            }
            1 => i += 8,
            5 => i += 4,
            _ => break,
        }
    }

    if found_tokens {
        Some(turn)
    } else {
        None
    }
}

/// Fallback reader: parses PLANNER_RESPONSE turns from `transcript.jsonl`
pub fn read_transcript_fallback(path: &Path) -> Vec<DecodedTurn> {
    let mut turns = Vec::new();
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return turns,
    };

    let reader = BufReader::new(file);
    for line in reader.lines().flatten() {
        if !line.contains("\"PLANNER_RESPONSE\"") {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            if v.get("type").and_then(|t| t.as_str()) == Some("PLANNER_RESPONSE") {
                let input = v.get("input_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                let output = v.get("output_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                let cache = v.get("cache_read_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                if input > 0 || output > 0 {
                    turns.push(DecodedTurn {
                        input_tokens: input,
                        output_tokens: output,
                        cache_read_tokens: cache,
                        model_name: None,
                    });
                }
            }
        }
    }

    turns
}
