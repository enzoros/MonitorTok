use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Origin {
    Ide,
    Cli,
}

impl Origin {
    pub fn as_str(&self) -> &'static str {
        match self {
            Origin::Ide => "IDE",
            Origin::Cli => "CLI",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AntigravityRoot {
    pub origin: Origin,
    pub path: PathBuf,
}

impl AntigravityRoot {
    pub fn conversations_dir(&self) -> PathBuf {
        self.path.join("conversations")
    }

    pub fn summaries_db(&self) -> PathBuf {
        self.path.join("conversation_summaries.db")
    }

    pub fn brain_dir(&self) -> PathBuf {
        self.path.join("brain")
    }
}

pub fn detect_roots() -> Vec<AntigravityRoot> {
    let mut roots = Vec::new();
    let home = match std::env::var("HOME") {
        Ok(h) => PathBuf::from(h),
        Err(_) => return roots,
    };

    let ide_path = home.join(".gemini/antigravity");
    if ide_path.exists() && ide_path.is_dir() {
        roots.push(AntigravityRoot {
            origin: Origin::Ide,
            path: ide_path,
        });
    }

    let cli_path = home.join(".gemini/antigravity-cli");
    if cli_path.exists() && cli_path.is_dir() {
        roots.push(AntigravityRoot {
            origin: Origin::Cli,
            path: cli_path,
        });
    }

    roots
}
