// Package portable owns the Go engine's writable filesystem contract.
//
// The resolver is deliberately independent of the user's profile and of the
// operating system's temporary/configuration directories. Packaged launches
// use the executable directory as the root. Development launches use a
// project-local .portable directory when the working directory contains
// go.mod; callers may provide a different development root through Options.
package portable

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	PortableRootEnv = "AIST_PORTABLE_ROOT"
	LegacyRootEnv   = "AI_SERVER_PORTABLE_ROOT"
	DataDirEnv      = "AI_SERVER_DATA_DIR"
)

// Paths is the complete writable layout used by the Go engine. Database is
// the SQLite file; DatabaseDir is exposed for callers that need the directory.
type Paths struct {
	Root              string
	Layout            string
	UsingLegacy       bool
	LegacyRoot        string
	Data              string
	Config            string
	DatabaseDir       string
	Database          string
	Logs              string
	EngineLog         string
	Cache             string
	Models            string
	Downloads         string
	Temp              string
	Memory            string
	Workflows         string
	Agents            string
	Backups           string
	Skills            string
	SkillsInstalled   string
	SkillsCustom      string
	SkillsRegistry    string
	SkillsManifest    string
	MCP               string
	MCPServers        string
	MCPConfigs        string
	MCPCredentials    string
	MCPManifest       string
	Toolcalls         string
	ToolcallHistory   string
	ToolcallResults   string
	ToolcallArtifacts string
	Runtime           string
	Engines           string
	Libraries         string
	Manifests         string
	Native            string
	Python            string
	ModelCache        string
}

// Options makes resolution deterministic in tests and for embedded callers.
// Environment is consulted instead of os.Environ when non-nil. ExecutablePath
// and WorkingDir are only used to select a development/package-local root.
type Options struct {
	Environment     map[string]string
	ExecutablePath  string
	WorkingDir      string
	DevelopmentRoot string
}

// Resolve resolves and creates the complete layout. It fails if a configured
// path escapes Root, traverses an existing symlink/junction, or is not
// writable. No system profile directory is ever used.
func Resolve() (Paths, error) { return ResolveWithOptions(Options{}) }

func ResolveWithOptions(options Options) (Paths, error) {
	env := func(name string) string {
		if options.Environment != nil {
			return strings.TrimSpace(options.Environment[name])
		}
		return strings.TrimSpace(os.Getenv(name))
	}

	workingDir := options.WorkingDir
	if workingDir == "" {
		workingDir, _ = os.Getwd()
	}
	workingDir, err := filepath.Abs(workingDir)
	if err != nil {
		return Paths{}, fmt.Errorf("portable working directory: %w", err)
	}
	executable := options.ExecutablePath
	if executable == "" {
		executable, _ = os.Executable()
	}
	if executable != "" {
		executable, _ = filepath.Abs(executable)
	}
	exeDir := workingDir
	if executable != "" {
		exeDir = filepath.Dir(executable)
	}

	rootValue := env(PortableRootEnv)
	if rootValue == "" {
		rootValue = env(LegacyRootEnv)
	}
	hasExplicitRoot := rootValue != ""
	var root string
	if hasExplicitRoot {
		root = anchor(rootValue, exeDir)
	} else if options.DevelopmentRoot != "" {
		root = anchor(options.DevelopmentRoot, workingDir)
	} else if fileExists(filepath.Join(workingDir, "go.mod")) {
		// `go run` executes a temporary binary outside the project tree. Keep
		// development data beside the source project instead of scattering the
		// portable layout under Go's temporary build directory.
		root = filepath.Join(workingDir, ".portable")
	} else {
		root = exeDir
	}
	root, err = filepath.Abs(filepath.Clean(root))
	if err != nil {
		return Paths{}, fmt.Errorf("portable root: %w", err)
	}
	if err = rejectTraversal(rootValue, "portable root"); err != nil {
		return Paths{}, err
	}
	if err = validateRoot(root); err != nil {
		return Paths{}, err
	}
	markerPaths, err := readMarkerPaths(root)
	if err != nil {
		return Paths{}, err
	}

	legacyRoot, legacyData := detectLegacyLayout(root)
	usingLegacy := legacyData != ""
	data := root
	if usingLegacy {
		data = legacyData
	}
	if configured := markerPaths["data"]; configured != "" {
		data = anchor(configured, root)
		usingLegacy = filepath.Clean(data) != filepath.Clean(root)
		if err = rejectTraversal(configured, "data"); err != nil {
			return Paths{}, err
		}
	}
	if configuredData := env(DataDirEnv); configuredData != "" {
		if !hasExplicitRoot && filepath.IsAbs(configuredData) {
			// An explicit absolute data override is supported for tests and
			// operators. Anchor the portable root to its parent so containment
			// remains enforced without scattering writes elsewhere.
			root = filepath.Clean(filepath.Dir(configuredData))
			if err = validateRoot(root); err != nil {
				return Paths{}, err
			}
		}
		data = anchor(configuredData, root)
		if err = rejectTraversal(configuredData, "data"); err != nil {
			return Paths{}, err
		}
	}
	if err = validateContained(root, data, "data"); err != nil {
		return Paths{}, err
	}

	layoutBase := root
	if usingLegacy {
		if legacyRoot == "" {
			legacyRoot = filepath.Dir(data)
		}
		layoutBase = legacyRoot
	}
	p := Paths{
		Root:        root,
		Layout:      "canonical",
		UsingLegacy: usingLegacy,
		LegacyRoot:  legacyRoot,
		Data:        data,
		Config:      filepath.Join(layoutBase, "config"),
		DatabaseDir: filepath.Join(data, "db"),
		Logs:        filepath.Join(data, "logs"),
		Cache:       filepath.Join(data, "cache"),
		Models:      filepath.Join(data, "models"),
		Downloads:   filepath.Join(data, "downloads"),
		Temp:        filepath.Join(data, "temp"),
		Memory:      filepath.Join(data, "memory"),
		Workflows:   filepath.Join(data, "workflows"),
		Agents:      filepath.Join(data, "agents"),
		Backups:     filepath.Join(data, "backups"),
		Skills:      filepath.Join(data, "skills"),
		MCP:         filepath.Join(data, "mcp"),
		Toolcalls:   filepath.Join(data, "toolcalls"),
		Runtime:     filepath.Join(layoutBase, ".runtime"),
		Engines:     filepath.Join(layoutBase, ".runtime", "engines"),
		Libraries:   filepath.Join(layoutBase, ".runtime", "libraries"),
		Manifests:   filepath.Join(layoutBase, ".runtime", "manifests"),
		Native:      filepath.Join(layoutBase, ".runtime", "libraries"),
		Python:      filepath.Join(layoutBase, ".runtime", "python"),
		ModelCache:  filepath.Join(data, "cache", "models"),
	}
	if usingLegacy {
		p.Layout = "legacy"
		p.Config = filepath.Join(data, "config")
		p.Runtime = filepath.Join(layoutBase, "runtime")
		p.Engines = filepath.Join(layoutBase, "runtime", "engines")
		p.Libraries = filepath.Join(layoutBase, "runtime", "native")
		p.Manifests = filepath.Join(layoutBase, "runtime", "manifests")
		p.Native = filepath.Join(layoutBase, "runtime", "native")
		p.Python = filepath.Join(layoutBase, "runtime", "python")
	}
	p.DatabaseDir = configuredPath(root, data, markerPaths, "db")
	p.Logs = configuredPath(root, data, markerPaths, "logs")
	p.Cache = configuredPath(root, data, markerPaths, "cache")
	p.Models = configuredPath(root, data, markerPaths, "models")
	p.Downloads = configuredPath(root, data, markerPaths, "downloads")
	p.Temp = configuredPath(root, data, markerPaths, "temp")
	p.Memory = configuredPath(root, data, markerPaths, "memory")
	p.Workflows = configuredPath(root, data, markerPaths, "workflows")
	p.Agents = configuredPath(root, data, markerPaths, "agents")
	p.Backups = configuredPath(root, data, markerPaths, "backups")
	if !usingLegacy {
		p.Config = configuredPath(root, root, markerPaths, "config")
		if configured := markerPaths["runtime"]; configured != "" {
			p.Runtime = anchor(configured, root)
		}
		p.Engines = filepath.Join(p.Runtime, "engines")
		p.Libraries = filepath.Join(p.Runtime, "libraries")
		p.Manifests = filepath.Join(p.Runtime, "manifests")
		if configured := markerPaths["engines"]; configured != "" {
			p.Engines = anchor(configured, root)
		}
		if configured := markerPaths["libraries"]; configured != "" {
			p.Libraries = anchor(configured, root)
		}
		if configured := markerPaths["manifests"]; configured != "" {
			p.Manifests = anchor(configured, root)
		}
		p.Native = p.Libraries
		p.Python = configuredPath(root, p.Runtime, markerPaths, "python")
	}
	p.ModelCache = filepath.Join(p.Cache, "models")
	if configured := markerPaths["modelCache"]; configured != "" {
		p.ModelCache = anchor(configured, root)
	}
	p.Database = filepath.Join(p.DatabaseDir, "studio.sqlite")
	p.EngineLog = filepath.Join(p.Logs, "engine.log")
	p.SkillsInstalled = filepath.Join(p.Skills, "installed")
	p.SkillsCustom = filepath.Join(p.Skills, "custom")
	p.SkillsRegistry = filepath.Join(p.Skills, "registry")
	p.SkillsManifest = filepath.Join(p.Skills, "skills.json")
	p.MCPServers = filepath.Join(p.MCP, "servers")
	p.MCPConfigs = filepath.Join(p.MCP, "configs")
	p.MCPCredentials = filepath.Join(p.MCP, "credentials")
	p.MCPManifest = filepath.Join(p.MCP, "mcp.json")
	p.ToolcallHistory = filepath.Join(p.Toolcalls, "history")
	p.ToolcallResults = filepath.Join(p.Toolcalls, "results")
	p.ToolcallArtifacts = filepath.Join(p.Toolcalls, "artifacts")
	if err = p.validate(); err != nil {
		return Paths{}, err
	}
	return p, nil
}

func anchor(value, base string) string {
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	return filepath.Join(base, value)
}

func configuredPath(root, base string, configured map[string]string, key string) string {
	if value := configured[key]; value != "" {
		return anchor(value, root)
	}
	return filepath.Join(base, key)
}

// readMarkerPaths accepts the same small portable.json path vocabulary as the
// The marker is configuration, never a reason to write
// outside Root; validate() rejects any configured escape before Ensure().
func readMarkerPaths(root string) (map[string]string, error) {
	result := make(map[string]string)
	raw, err := os.ReadFile(filepath.Join(root, "portable.json"))
	if os.IsNotExist(err) {
		return result, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read portable.json: %w", err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, fmt.Errorf("invalid portable.json: %w", err)
	}
	values := document
	if nested, ok := document["paths"]; ok {
		var nestedValues map[string]json.RawMessage
		if err := json.Unmarshal(nested, &nestedValues); err != nil {
			return nil, errors.New("portable.json.paths must contain a JSON object")
		}
		values = make(map[string]json.RawMessage, len(document)+len(nestedValues))
		for key, value := range document {
			values[key] = value
		}
		for key, value := range nestedValues {
			values[key] = value
		}
	}
	aliases := map[string]string{
		"dataDir": "data", "configDir": "config", "dbDir": "db", "logsDir": "logs",
		"cacheDir": "cache", "modelsDir": "models", "downloadsDir": "downloads",
		"tempDir": "temp", "memoryDir": "memory", "workflowsDir": "workflows",
		"agentsDir": "agents", "backupsDir": "backups", "sessionDir": "sessionData",
		"sessionDataDir": "sessionData", "crashDumpsDir": "crashDumps",
	}
	for key, value := range values {
		canonical := aliases[key]
		if canonical == "" {
			canonical = key
		}
		if canonical == "paths" || canonical == "portable" || canonical == "version" || canonical == "mode" {
			continue
		}
		var text string
		if err := json.Unmarshal(value, &text); err != nil {
			continue
		}
		if strings.TrimSpace(text) != "" {
			result[canonical] = strings.TrimSpace(text)
		}
	}
	return result, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// detectLegacyLayout selects an existing pre-canonical tree without moving or
// deleting it. A canonical database wins when both layouts are present, which
// makes an explicit migration or restore authoritative instead of silently
// switching back to older data.
func detectLegacyLayout(root string) (legacyRoot, data string) {
	if fileExists(filepath.Join(root, "db", "studio.sqlite")) {
		return "", ""
	}
	portableRoot := filepath.Join(root, ".portable")
	if dirExists(filepath.Join(portableRoot, "data")) {
		return portableRoot, filepath.Join(portableRoot, "data")
	}
	if dirExists(filepath.Join(root, "data")) {
		return root, filepath.Join(root, "data")
	}
	// Some earlier portable builds kept the runtime tree at the executable
	// root while their data directory was created lazily. Reuse that layout
	// instead of creating a new canonical database beside the old runtime.
	if dirExists(filepath.Join(root, "runtime")) {
		return root, filepath.Join(root, "data")
	}
	return "", ""
}

func validateRoot(root string) error {
	if root == "" || root == string(filepath.Separator) || filepath.Dir(root) == root {
		return errors.New("portable root must be a non-root directory")
	}
	for current := root; ; current = filepath.Dir(current) {
		if info, err := os.Lstat(current); err == nil {
			if info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("portable root must not traverse a symlink or junction: %s", current)
			}
			if current == root && !info.IsDir() {
				return fmt.Errorf("portable root is not a directory: %s", root)
			}
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("inspect portable root %q: %w", current, err)
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
	}
	return nil
}

func rejectTraversal(value, label string) error {
	if value == "" || filepath.IsAbs(value) {
		return nil
	}
	for _, part := range strings.FieldsFunc(value, func(r rune) bool { return r == '/' || r == '\\' }) {
		if part == ".." {
			return fmt.Errorf("portable %s contains traversal: %q", label, value)
		}
	}
	return nil
}

func contained(root, candidate string) bool {
	rel, err := filepath.Rel(root, candidate)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func validateContained(root, candidate, label string) error {
	root = filepath.Clean(root)
	candidate = filepath.Clean(candidate)
	if !contained(root, candidate) {
		return fmt.Errorf("portable %s escapes root %q: %s", label, root, candidate)
	}
	if err := validateRoot(root); err != nil {
		return err
	}
	rootReal := root
	if _, err := os.Stat(root); err == nil {
		var realErr error
		rootReal, realErr = filepath.EvalSymlinks(root)
		if realErr != nil {
			return fmt.Errorf("resolve portable root: %w", realErr)
		}
	}
	current := candidate
	for {
		if info, err := os.Lstat(current); err == nil {
			if info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("portable %s traverses a symlink or junction: %s", label, current)
			}
			if real, realErr := filepath.EvalSymlinks(current); realErr == nil && !contained(rootReal, real) {
				return fmt.Errorf("portable %s resolves outside root: %s", label, current)
			}
			break
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("inspect portable %s %q: %w", label, current, err)
		}
		parent := filepath.Dir(current)
		if parent == current || !contained(root, parent) {
			// A not-yet-created root has existing ancestors outside Root. Those
			// ancestors are not part of the configured path and must not be
			// treated as an escape or symlink target.
			break
		}
		current = parent
	}
	return nil
}

func (p Paths) validate() error {
	for label, path := range map[string]string{
		"data": p.Data, "config": p.Config, "database": p.DatabaseDir,
		"logs": p.Logs, "cache": p.Cache, "models": p.Models, "downloads": p.Downloads,
		"temp": p.Temp, "memory": p.Memory, "workflows": p.Workflows, "agents": p.Agents,
		"backups": p.Backups, "skills": p.Skills, "mcp": p.MCP, "toolcalls": p.Toolcalls,
		"skills installed": p.SkillsInstalled, "skills custom": p.SkillsCustom,
		"skills registry": p.SkillsRegistry, "mcp servers": p.MCPServers,
		"mcp configs": p.MCPConfigs, "mcp credentials": p.MCPCredentials,
		"toolcall history": p.ToolcallHistory, "toolcall results": p.ToolcallResults,
		"toolcall artifacts": p.ToolcallArtifacts,
		"runtime":            p.Runtime, "engines": p.Engines, "libraries": p.Libraries,
		"manifests": p.Manifests, "native": p.Native, "python": p.Python,
		"model cache": p.ModelCache,
	} {
		if err := validateContained(p.Root, path, label); err != nil {
			return err
		}
	}
	for label, path := range map[string]string{"skills manifest": p.SkillsManifest, "MCP manifest": p.MCPManifest} {
		if err := validateContained(p.Root, path, label); err != nil {
			return err
		}
		if info, err := os.Lstat(path); err == nil && info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("portable %s must not be a symlink: %s", label, path)
		} else if err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("inspect portable %s %q: %w", label, path, err)
		}
	}
	return validateContained(p.Root, p.Database, "database file")
}

// Ensure creates all required directories and probes each one with a private
// file. This catches read-only media and invalid junction targets at startup.
func (p Paths) Ensure() error {
	if err := p.validate(); err != nil {
		return err
	}
	dirs := []string{p.Root, p.Data, p.Config, p.DatabaseDir, p.Logs, p.Cache, p.Models, p.Downloads, p.Temp, p.Memory, p.Workflows, p.Agents, p.Backups,
		p.Skills, p.SkillsInstalled, p.SkillsCustom, p.SkillsRegistry,
		p.MCP, p.MCPServers, p.MCPConfigs, p.MCPCredentials,
		p.Toolcalls, p.ToolcallHistory, p.ToolcallResults, p.ToolcallArtifacts,
		p.Runtime, p.Engines, p.Libraries, p.Manifests, p.Native, p.Python, p.ModelCache}
	seen := map[string]bool{}
	for _, dir := range dirs {
		if seen[dir] {
			continue
		}
		seen[dir] = true
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("create portable %s: %w", dir, err)
		}
		if err := validateContained(p.Root, dir, "directory"); err != nil {
			return err
		}
		probe := filepath.Join(dir, ".aist-write-test")
		f, err := os.OpenFile(probe, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return fmt.Errorf("portable directory is not writable %q: %w", dir, err)
		}
		if err = f.Close(); err != nil {
			return fmt.Errorf("close portable write probe %q: %w", dir, err)
		}
		if err = os.Remove(probe); err != nil {
			return fmt.Errorf("remove portable write probe %q: %w", dir, err)
		}
	}
	if err := ensureManifest(p.SkillsManifest, map[string]interface{}{
		"version": 1, "installed": []string{}, "custom": []string{}, "registry": []string{},
	}); err != nil {
		return fmt.Errorf("initialize skills manifest: %w", err)
	}
	credentialStore := "external-secret-store"
	if strings.EqualFold(os.Getenv("OS"), "Windows_NT") || filepath.Separator == '\\' {
		credentialStore = "windows-credential-manager"
	}
	if err := ensureManifest(p.MCPManifest, map[string]interface{}{
		"version": 1, "servers": []string{},
		"credentials": map[string]interface{}{"store": credentialStore, "plaintext": false},
	}); err != nil {
		return fmt.Errorf("initialize MCP manifest: %w", err)
	}
	return nil
}

func ensureManifest(path string, value interface{}) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err = f.Write(raw); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

func (p Paths) environmentValues() map[string]string {
	return map[string]string{
		PortableRootEnv: p.Root, LegacyRootEnv: p.Root, "AIST_PORTABLE": "1",
		"AI_SERVER_DATA_DIR": p.Data, "AIST_PORTABLE_DATA_DIR": p.Data,
		"AIST_CONFIG_DIR": p.Config, "AI_SERVER_CONFIG_DIR": p.Config,
		"AIST_DB_DIR": p.DatabaseDir, "AI_SERVER_DB_DIR": p.DatabaseDir,
		"AIST_DB_PATH": p.Database, "AI_SERVER_DB_PATH": p.Database,
		"AIST_LOGS_DIR": p.Logs, "AI_SERVER_LOGS_DIR": p.Logs,
		"AIST_MODELS_DIR": p.Models, "AI_SERVER_MODELS_DIR": p.Models,
		"AIST_DOWNLOADS_DIR": p.Downloads, "AI_SERVER_DOWNLOADS_DIR": p.Downloads,
		"AIST_TEMP_DIR": p.Temp, "AI_SERVER_TEMP_DIR": p.Temp,
		"AIST_SKILLS_DIR": p.Skills, "AIST_MCP_DIR": p.MCP, "AIST_TOOLCALLS_DIR": p.Toolcalls,
		"AIST_SKILLS_INSTALLED_DIR": p.SkillsInstalled, "AIST_SKILLS_CUSTOM_DIR": p.SkillsCustom,
		"AIST_SKILLS_REGISTRY_DIR": p.SkillsRegistry, "AIST_SKILLS_MANIFEST": p.SkillsManifest,
		"AIST_MCP_SERVERS_DIR": p.MCPServers, "AIST_MCP_CONFIGS_DIR": p.MCPConfigs,
		"AIST_MCP_CREDENTIALS_DIR": p.MCPCredentials, "AIST_MCP_MANIFEST": p.MCPManifest,
		"AIST_TOOLCALL_HISTORY_DIR": p.ToolcallHistory, "AIST_TOOLCALL_RESULTS_DIR": p.ToolcallResults,
		"AIST_TOOLCALL_ARTIFACTS_DIR": p.ToolcallArtifacts,
		"AIST_RUNTIME_DIR":            p.Runtime, "AIST_ENGINE_DIR": p.Engines,
		"AIST_LIBRARIES_DIR": p.Libraries, "AIST_MANIFESTS_DIR": p.Manifests,
		// Windows libraries consult APPDATA/LOCALAPPDATA directly instead of
		// HOME or XDG_* variables. Keep those writes inside the portable root.
		"APPDATA": p.Config, "LOCALAPPDATA": p.Cache,
		"XDG_CONFIG_HOME": p.Config, "XDG_CACHE_HOME": p.Cache, "XDG_DATA_HOME": p.Data,
		"HOME": p.Root, "USERPROFILE": p.Root, "TMPDIR": p.Temp, "TMP": p.Temp, "TEMP": p.Temp,
		"PIP_CACHE_DIR": p.Cache, "HF_HOME": p.ModelCache, "HF_HUB_CACHE": p.ModelCache,
		"TRANSFORMERS_CACHE": p.ModelCache, "TORCH_HOME": p.Cache, "VLLM_CACHE_ROOT": p.Cache,
	}
}

// ApplyEnvironment makes the current process use the portable roots. This is
// needed before initializing native libraries: unlike explicitly launched
// child processes, those libraries inherit the engine process environment.
func (p Paths) ApplyEnvironment() error {
	// The parent process intentionally keeps its inherited environment. Changing
	// APPDATA, LOCALAPPDATA, USERPROFILE, TEMP, or even portable data variables
	// here leaks state across in-process tests and into WebView2/graphics
	// libraries. Child runtimes receive the complete portable environment through
	// ChildEnvironment instead.
	return nil
}

func (p Paths) parentEnvironmentValues() map[string]string {
	return map[string]string{}
}

// ChildEnvironment overlays portable cache/temp/home/config values on a child
// process only. It never mutates the parent process environment.
func (p Paths) ChildEnvironment(base []string) []string {
	values := p.environmentValues()
	order := make([]string, 0, len(base)+len(values))
	seen := map[string]bool{}
	for _, item := range base {
		key := item
		if i := strings.IndexByte(item, '='); i >= 0 {
			key = item[:i]
		}
		if value, ok := values[key]; ok {
			order = append(order, key+"="+value)
			seen[key] = true
		} else {
			order = append(order, item)
		}
	}
	for key, value := range values {
		if !seen[key] {
			order = append(order, key+"="+value)
		}
	}
	return order
}
