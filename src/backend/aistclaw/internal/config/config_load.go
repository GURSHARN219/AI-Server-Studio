package config

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/titanous/json5"
)

// Default returns a Config with sensible defaults.
func Default() *Config {
	return &Config{
		DataDir: "~/.aistclaw/data",
		Agents: AgentsConfig{
			Defaults: AgentDefaults{
				Workspace:           "~/.aistclaw/workspace",
				RestrictToWorkspace: true,
				Provider:            "anthropic",
				Model:               "claude-sonnet-4-5-20250929",
				MaxTokens:           DefaultMaxTokens,
				Temperature:         DefaultTemperature,
				MaxToolIterations:   DefaultMaxIterations,
				MaxToolCalls:        25,
				ContextWindow:       DefaultContextWindow,
				Subagents: &SubagentsConfig{
					MaxConcurrent: 20,
					MaxSpawnDepth: 1,
				},
			},
		},
		Channels: ChannelsConfig{
			Telegram: TelegramConfig{
				ReactionLevel: "full",
			},
		},
		Gateway: GatewayConfig{
			Host:            "0.0.0.0",
			Port:            18790,
			MaxMessageChars: DefaultMaxMessageChars,
			RateLimitRPM:    20,
		},
		Tools: ToolsConfig{
			Web: WebToolsConfig{
				DuckDuckGo: DuckDuckGoConfig{Enabled: true, MaxResults: 5},
			},
			Browser: BrowserToolConfig{
				Enabled:  true,
				Headless: true,
			},
			ExecApproval: ExecApprovalCfg{
				Security: "full",
				Ask:      "off",
			},
			RateLimitPerHour: 150,
		},
		Sessions: SessionsConfig{},
	}
}

// Load reads config from a JSON file, then overlays env vars.
func Load(path string) (*Config, error) {
	cfg := Default()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg.applyEnvOverrides()
			return cfg, nil
		}
		return nil, fmt.Errorf("read config: %w", err)
	}

	if err := json5.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	cfg.applyEnvOverrides()
	return cfg, nil
}

// applyEnvOverrides overlays env vars onto the config.
// Env vars take precedence over file values.
func (c *Config) applyEnvOverrides() {
	for _, envEntry := range os.Environ() {
		key, value, ok := strings.Cut(envEntry, "=")
		if !ok || !strings.HasPrefix(key, "AISTCLAW_") || value == "" {
			continue
		}
		aliasKey := "AISTCLAW_" + strings.TrimPrefix(key, "AISTCLAW_")
		if os.Getenv(aliasKey) == "" {
			_ = os.Setenv(aliasKey, value)
		}
	}

	envStr := func(key string, dst *string) {
		if v := os.Getenv(key); v != "" {
			*dst = v
		}
	}
	envStr("AISTCLAW_ANTHROPIC_API_KEY", &c.Providers.Anthropic.APIKey)
	envStr("AISTCLAW_ANTHROPIC_BASE_URL", &c.Providers.Anthropic.APIBase)
	envStr("AISTCLAW_OPENAI_API_KEY", &c.Providers.OpenAI.APIKey)
	envStr("AISTCLAW_OPENAI_BASE_URL", &c.Providers.OpenAI.APIBase)
	envStr("AISTCLAW_OPENROUTER_API_KEY", &c.Providers.OpenRouter.APIKey)
	envStr("AISTCLAW_GROQ_API_KEY", &c.Providers.Groq.APIKey)
	envStr("AISTCLAW_DEEPSEEK_API_KEY", &c.Providers.DeepSeek.APIKey)
	envStr("AISTCLAW_GEMINI_API_KEY", &c.Providers.Gemini.APIKey)
	envStr("AISTCLAW_MISTRAL_API_KEY", &c.Providers.Mistral.APIKey)
	envStr("AISTCLAW_XAI_API_KEY", &c.Providers.XAI.APIKey)
	envStr("AISTCLAW_MINIMAX_API_KEY", &c.Providers.MiniMax.APIKey)
	envStr("AISTCLAW_COHERE_API_KEY", &c.Providers.Cohere.APIKey)
	envStr("AISTCLAW_PERPLEXITY_API_KEY", &c.Providers.Perplexity.APIKey)
	envStr("AISTCLAW_DASHSCOPE_API_KEY", &c.Providers.DashScope.APIKey)
	envStr("AISTCLAW_BAILIAN_API_KEY", &c.Providers.Bailian.APIKey)
	envStr("AISTCLAW_ZAI_API_KEY", &c.Providers.Zai.APIKey)
	envStr("AISTCLAW_ZAI_CODING_API_KEY", &c.Providers.ZaiCoding.APIKey)
	envStr("AISTCLAW_OLLAMA_HOST", &c.Providers.Ollama.Host)
	envStr("AISTCLAW_OLLAMA_CLOUD_API_KEY", &c.Providers.OllamaCloud.APIKey)
	envStr("AISTCLAW_OLLAMA_CLOUD_API_BASE", &c.Providers.OllamaCloud.APIBase)
	envStr("AISTCLAW_GATEWAY_TOKEN", &c.Gateway.Token)
	envStr("AISTCLAW_TELEGRAM_TOKEN", &c.Channels.Telegram.Token)
	envStr("AISTCLAW_DISCORD_TOKEN", &c.Channels.Discord.Token)
	envStr("AISTCLAW_ZALO_TOKEN", &c.Channels.Zalo.Token)
	envStr("AISTCLAW_LARK_APP_ID", &c.Channels.Feishu.AppID)
	envStr("AISTCLAW_LARK_APP_SECRET", &c.Channels.Feishu.AppSecret)
	envStr("AISTCLAW_LARK_ENCRYPT_KEY", &c.Channels.Feishu.EncryptKey)
	envStr("AISTCLAW_LARK_VERIFICATION_TOKEN", &c.Channels.Feishu.VerificationToken)
	envStr("AISTCLAW_WHATSAPP_BRIDGE_URL", &c.Channels.WhatsApp.BridgeURL)
	envStr("AISTCLAW_SLACK_BOT_TOKEN", &c.Channels.Slack.BotToken)
	envStr("AISTCLAW_SLACK_APP_TOKEN", &c.Channels.Slack.AppToken)
	envStr("AISTCLAW_SLACK_USER_TOKEN", &c.Channels.Slack.UserToken)

	// TTS secrets
	envStr("AISTCLAW_TTS_OPENAI_API_KEY", &c.Tts.OpenAI.APIKey)
	envStr("AISTCLAW_TTS_ELEVENLABS_API_KEY", &c.Tts.ElevenLabs.APIKey)
	envStr("AISTCLAW_TTS_MINIMAX_API_KEY", &c.Tts.MiniMax.APIKey)
	envStr("AISTCLAW_TTS_MINIMAX_GROUP_ID", &c.Tts.MiniMax.GroupID)

	// Auto-enable channels if credentials are provided via env
	if c.Channels.Telegram.Token != "" {
		c.Channels.Telegram.Enabled = true
	}
	if c.Channels.Discord.Token != "" {
		c.Channels.Discord.Enabled = true
	}
	if c.Channels.Zalo.Token != "" {
		c.Channels.Zalo.Enabled = true
	}
	if c.Channels.Feishu.AppID != "" && c.Channels.Feishu.AppSecret != "" {
		c.Channels.Feishu.Enabled = true
	}
	if c.Channels.WhatsApp.BridgeURL != "" {
		c.Channels.WhatsApp.Enabled = true
	}
	if c.Channels.Slack.BotToken != "" && c.Channels.Slack.AppToken != "" {
		c.Channels.Slack.Enabled = true
	}

	// Claude CLI provider
	envStr("AISTCLAW_CLAUDE_CLI_PATH", &c.Providers.ClaudeCLI.CLIPath)
	envStr("AISTCLAW_CLAUDE_CLI_MODEL", &c.Providers.ClaudeCLI.Model)
	envStr("AISTCLAW_CLAUDE_CLI_WORK_DIR", &c.Providers.ClaudeCLI.BaseWorkDir)

	// Default provider/model: env is fallback only (applied when config has no value).
	// The onboard wizard sets these in .env for initial bootstrap; once the user
	// saves a provider/model via the Dashboard, the config-file value wins.
	envFallback := func(key string, dst *string) {
		if *dst == "" {
			if v := os.Getenv(key); v != "" {
				*dst = v
			}
		}
	}
	envFallback("AISTCLAW_PROVIDER", &c.Agents.Defaults.Provider)
	envFallback("AISTCLAW_MODEL", &c.Agents.Defaults.Model)

	// Data directory, workspace & sessions
	envStr("AISTCLAW_DATA_DIR", &c.DataDir)
	envStr("AISTCLAW_WORKSPACE", &c.Agents.Defaults.Workspace)

	// Gateway host/port
	envStr("AISTCLAW_HOST", &c.Gateway.Host)
	if v := os.Getenv("AISTCLAW_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil && port > 0 {
			c.Gateway.Port = port
		}
	}

	// Database
	envStr("AISTCLAW_POSTGRES_DSN", &c.Database.PostgresDSN)
	envStr("AISTCLAW_REDIS_DSN", &c.Database.RedisDSN)
	envStr("AISTCLAW_STORAGE_BACKEND", &c.Database.StorageBackend)
	envStr("AISTCLAW_SQLITE_PATH", &c.Database.SQLitePath)

	// Deprecation warning for AISTCLAW_MODE (removed — PostgreSQL is always active)
	if v := os.Getenv("AISTCLAW_MODE"); v != "" {
		slog.Warn("AISTCLAW_MODE is deprecated; managed mode is now the only mode", "value", v)
	}

	// Telemetry
	envStr("AISTCLAW_TELEMETRY_ENDPOINT", &c.Telemetry.Endpoint)
	envStr("AISTCLAW_TELEMETRY_PROTOCOL", &c.Telemetry.Protocol)
	envStr("AISTCLAW_TELEMETRY_SERVICE_NAME", &c.Telemetry.ServiceName)
	if v := os.Getenv("AISTCLAW_TELEMETRY_ENABLED"); v != "" {
		c.Telemetry.Enabled = v == "true" || v == "1"
	}
	if v := os.Getenv("AISTCLAW_TELEMETRY_INSECURE"); v != "" {
		c.Telemetry.Insecure = v == "true" || v == "1"
	}

	// Owner IDs from env (comma-separated, whitespace-trimmed)
	if v := os.Getenv("AISTCLAW_OWNER_IDS"); v != "" {
		var ids []string
		for id := range strings.SplitSeq(v, ",") {
			if trimmed := strings.TrimSpace(id); trimmed != "" {
				ids = append(ids, trimmed)
			}
		}
		c.Gateway.OwnerIDs = ids
	}

	// Allowed origins from env (comma-separated, whitespace-trimmed)
	if v := os.Getenv("AISTCLAW_ALLOWED_ORIGINS"); v != "" {
		var origins []string
		for origin := range strings.SplitSeq(v, ",") {
			if trimmed := strings.TrimSpace(origin); trimmed != "" {
				origins = append(origins, trimmed)
			}
		}
		c.Gateway.AllowedOrigins = origins
	}

	// Tailscale (tsnet)
	envStr("AISTCLAW_TSNET_HOSTNAME", &c.Tailscale.Hostname)
	envStr("AISTCLAW_TSNET_AUTH_KEY", &c.Tailscale.AuthKey)
	envStr("AISTCLAW_TSNET_DIR", &c.Tailscale.StateDir)

	// Sandbox (for Docker-compose sandbox overlay)
	ensureSandbox := func() {
		if c.Agents.Defaults.Sandbox == nil {
			c.Agents.Defaults.Sandbox = &SandboxConfig{}
		}
	}
	if v := os.Getenv("AISTCLAW_SANDBOX_MODE"); v != "" {
		ensureSandbox()
		c.Agents.Defaults.Sandbox.Mode = v
	}
	if v := os.Getenv("AISTCLAW_SANDBOX_IMAGE"); v != "" {
		ensureSandbox()
		c.Agents.Defaults.Sandbox.Image = v
	}
	if v := os.Getenv("AISTCLAW_SANDBOX_WORKSPACE_ACCESS"); v != "" {
		ensureSandbox()
		c.Agents.Defaults.Sandbox.WorkspaceAccess = v
	}
	if v := os.Getenv("AISTCLAW_SANDBOX_SCOPE"); v != "" {
		ensureSandbox()
		c.Agents.Defaults.Sandbox.Scope = v
	}
	if v := os.Getenv("AISTCLAW_SANDBOX_MEMORY_MB"); v != "" {
		ensureSandbox()
		if mb, err := strconv.Atoi(v); err == nil && mb > 0 {
			c.Agents.Defaults.Sandbox.MemoryMB = mb
		}
	}
	if v := os.Getenv("AISTCLAW_SANDBOX_CPUS"); v != "" {
		ensureSandbox()
		if cpus, err := strconv.ParseFloat(v, 64); err == nil && cpus > 0 {
			c.Agents.Defaults.Sandbox.CPUs = cpus
		}
	}
	if v := os.Getenv("AISTCLAW_SANDBOX_TIMEOUT_SEC"); v != "" {
		ensureSandbox()
		if sec, err := strconv.Atoi(v); err == nil && sec > 0 {
			c.Agents.Defaults.Sandbox.TimeoutSec = sec
		}
	}
	if v := os.Getenv("AISTCLAW_SANDBOX_NETWORK"); v != "" {
		ensureSandbox()
		c.Agents.Defaults.Sandbox.NetworkEnabled = v == "true" || v == "1"
	}

	// Browser (for Docker-compose browser sidecar overlay)
	envStr("AISTCLAW_BROWSER_REMOTE_URL", &c.Tools.Browser.RemoteURL)
	if c.Tools.Browser.RemoteURL != "" {
		c.Tools.Browser.Enabled = true
	}
}


// Save writes the config to a JSON file.
func Save(path string, cfg *Config) error {
	cfg.mu.RLock()
	defer cfg.mu.RUnlock()

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}

// Hash returns a SHA-256 hash of the config for optimistic concurrency.
func (c *Config) Hash() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, _ := json.Marshal(c)
	h := sha256.Sum256(data)
	return fmt.Sprintf("%x", h[:8])
}

// ResolvedDataDir returns the expanded data directory path.
func (c *Config) ResolvedDataDir() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return ExpandHome(c.DataDir)
}

// ResolvedDataDirFromEnv returns the data dir from AISTCLAW_DATA_DIR env or default.
// Use this in packages that don't have access to a Config instance.
func ResolvedDataDirFromEnv() string {
	if v := os.Getenv("AISTCLAW_DATA_DIR"); v != "" {
		return ExpandHome(v)
	}
	return ExpandHome("~/.aistclaw/data")
}

// WorkspacePath returns the expanded workspace path.
func (c *Config) WorkspacePath() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return ExpandHome(c.Agents.Defaults.Workspace)
}

// ResolveAgent returns the effective config for a given agent ID,
// merging defaults with per-agent overrides.
func (c *Config) ResolveAgent(agentID string) AgentDefaults {
	c.mu.RLock()
	defer c.mu.RUnlock()

	d := c.Agents.Defaults
	if spec, ok := c.Agents.List[agentID]; ok {
		if spec.Provider != "" {
			d.Provider = spec.Provider
		}
		if spec.Model != "" {
			d.Model = spec.Model
		}
		if spec.MaxTokens > 0 {
			d.MaxTokens = spec.MaxTokens
		}
		if spec.Temperature > 0 {
			d.Temperature = spec.Temperature
		}
		if spec.MaxToolIterations > 0 {
			d.MaxToolIterations = spec.MaxToolIterations
		}
		if spec.ContextWindow > 0 {
			d.ContextWindow = spec.ContextWindow
		}
		if spec.MaxToolCalls > 0 {
			d.MaxToolCalls = spec.MaxToolCalls
		}
		if spec.Workspace != "" {
			d.Workspace = spec.Workspace
		}
		if spec.Sandbox != nil {
			d.Sandbox = spec.Sandbox
		}
		if spec.AgentType != "" {
			d.AgentType = spec.AgentType
		}
	}

	return d
}

// ResolveDefaultAgentID returns the ID of the agent marked as default,
// or "default" if none is explicitly marked.
func (c *Config) ResolveDefaultAgentID() string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	for id, spec := range c.Agents.List {
		if spec.Default {
			return id
		}
	}
	return DefaultAgentID
}

// ResolveDisplayName returns the display name for an agent.
// Falls back to "Aistclaw" if not configured.
func (c *Config) ResolveDisplayName(agentID string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if spec, ok := c.Agents.List[agentID]; ok && spec.DisplayName != "" {
		return spec.DisplayName
	}
	return "Aistclaw"
}

// ApplyEnvOverrides re-applies environment variable overrides onto the config.
// Call this after modifying config to restore runtime secrets from env vars.
func (c *Config) ApplyEnvOverrides() {
	c.applyEnvOverrides()
}

// ExpandHome replaces leading ~ with the user home directory.
func ExpandHome(path string) string {
	if path == "" || path[0] != '~' {
		return path
	}
	home, _ := os.UserHomeDir()
	if len(path) > 1 && path[1] == '/' {
		return home + path[1:]
	}
	return home
}

// ContractHome replaces the user home directory prefix with ~.
// Reverse of ExpandHome — used to store portable paths in the database.
func ContractHome(path string) string {
	if path == "" {
		return path
	}
	home, _ := os.UserHomeDir()
	if home != "" && strings.HasPrefix(path, home) {
		return "~" + path[len(home):]
	}
	return path
}
