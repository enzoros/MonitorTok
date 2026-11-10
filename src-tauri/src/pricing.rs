use crate::models::ModelPrice;
use regex::Regex;

pub struct PricingEngine {
    rules: Vec<(Regex, ModelPrice)>,
    default_price: ModelPrice,
}

impl PricingEngine {
    pub fn new(prices: Vec<ModelPrice>) -> Self {
        let default_price = ModelPrice {
            model_pattern: "default".to_string(),
            display_name: "Modelo Estándar / Desconocido".to_string(),
            input_per_1m: 1.00,
            cache_read_per_1m: 0.25,
            output_per_1m: 4.00,
            valid_from: None,
            valid_to: None,
        };

        let mut rules = Vec::new();
        for p in prices {
            let pattern = p.model_pattern.clone();
            // Convert wildcard pattern like 'claude-*-sonnet*' into regex '(?i)^.*claude.*sonnet.*$'
            let regex_str = if pattern.contains('*') {
                let escaped = regex::escape(&pattern).replace("\\*", ".*");
                format!("(?i){}", escaped)
            } else {
                format!("(?i){}", regex::escape(&pattern))
            };

            if let Ok(re) = Regex::new(&regex_str) {
                rules.push((re, p));
            }
        }

        Self {
            rules,
            default_price,
        }
    }

    pub fn calculate_cost_at(
        &self,
        model: &str,
        timestamp: Option<i64>,
        input: u64,
        cache: u64,
        output: u64,
    ) -> (f64, String) {
        let price = self
            .rules
            .iter()
            .find(|(re, p)| {
                if !re.is_match(model) {
                    return false;
                }
                if let Some(ts) = timestamp {
                    if let Some(from) = p.valid_from {
                        if ts < from {
                            return false;
                        }
                    }
                    if let Some(to) = p.valid_to {
                        if ts >= to {
                            return false;
                        }
                    }
                }
                true
            })
            .map(|(_, p)| p)
            .unwrap_or(&self.default_price);

        let cost_in = (input as f64 / 1_000_000.0) * price.input_per_1m;
        let cost_cache = (cache as f64 / 1_000_000.0) * price.cache_read_per_1m;
        let cost_out = (output as f64 / 1_000_000.0) * price.output_per_1m;
        let total_cost = cost_in + cost_cache + cost_out;

        (total_cost, price.display_name.clone())
    }

    pub fn calculate_cost(&self, model: &str, input: u64, cache: u64, output: u64) -> (f64, String) {
        self.calculate_cost_at(model, None, input, cache, output)
    }
}

pub fn default_pricing() -> Vec<ModelPrice> {
    vec![
        ModelPrice {
            model_pattern: "*flash-lite*".to_string(),
            display_name: "Google Gemini 3.5 Flash-Lite".to_string(),
            input_per_1m: 0.10,
            cache_read_per_1m: 0.01,
            output_per_1m: 0.40,
            valid_from: None,
            valid_to: None,
        },
        // Flash Promo 2026 (Hasta 31 Dic 2026)
        ModelPrice {
            model_pattern: "*flash*".to_string(),
            display_name: "Google Gemini 3.8 Flash (Promo 2026)".to_string(),
            input_per_1m: 0.75,
            cache_read_per_1m: 0.075,
            output_per_1m: 3.75,
            valid_from: None,
            valid_to: Some(1798761600), // 2027-01-01 00:00:00 UTC
        },
        // Flash Estándar 2027 (Desde 1 Ene 2027)
        ModelPrice {
            model_pattern: "*flash*".to_string(),
            display_name: "Google Gemini 3.8 Flash (Estándar 2027)".to_string(),
            input_per_1m: 1.50,
            cache_read_per_1m: 0.15,
            output_per_1m: 7.50,
            valid_from: Some(1798761600),
            valid_to: None,
        },
        // Argon Promo (Hasta 30 Nov 2026)
        ModelPrice {
            model_pattern: "*argon*".to_string(),
            display_name: "Google Gemini 4 Argon (Promo)".to_string(),
            input_per_1m: 2.00,
            cache_read_per_1m: 0.10,
            output_per_1m: 10.00,
            valid_from: None,
            valid_to: Some(1796083200), // 2026-12-01 00:00:00 UTC
        },
        // Argon Oficial (Desde 1 Dic 2026)
        ModelPrice {
            model_pattern: "*argon*".to_string(),
            display_name: "Google Gemini 4 Argon (Oficial)".to_string(),
            input_per_1m: 4.00,
            cache_read_per_1m: 0.20,
            output_per_1m: 20.00,
            valid_from: Some(1796083200),
            valid_to: None,
        },
        ModelPrice {
            model_pattern: "*pro*".to_string(),
            display_name: "Google Gemini 3.1 Pro".to_string(),
            input_per_1m: 2.00,
            cache_read_per_1m: 0.20,
            output_per_1m: 12.00,
            valid_from: None,
            valid_to: None,
        },
        ModelPrice {
            model_pattern: "*sonnet*".to_string(),
            display_name: "Anthropic Claude 3.5 Sonnet".to_string(),
            input_per_1m: 3.00,
            cache_read_per_1m: 0.30,
            output_per_1m: 15.00,
            valid_from: None,
            valid_to: None,
        },
        ModelPrice {
            model_pattern: "*opus*".to_string(),
            display_name: "Anthropic Claude 3.5 Opus".to_string(),
            input_per_1m: 15.00,
            cache_read_per_1m: 1.50,
            output_per_1m: 75.00,
            valid_from: None,
            valid_to: None,
        },
    ]
}
