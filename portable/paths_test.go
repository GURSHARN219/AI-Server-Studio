package portable

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func testEnv(root string) map[string]string {
	return map[string]string{PortableRootEnv: root, LegacyRootEnv: ""}
}

func TestResolvePortableLayoutAndDatabaseSidecar(t *testing.T) {
	root := t.TempDir()
	p, err := ResolveWithOptions(Options{Environment: testEnv(root), WorkingDir: root, ExecutablePath: filepath.Join(root, "engine")})
	if err != nil {
		t.Fatal(err)
	}
	if p.Layout != "canonical" || p.UsingLegacy || p.Data != root || p.Database != filepath.Join(root, "db", "studio.sqlite") {
		t.Fatalf("unexpected database layout: %#v", p)
	}
	if p.EngineLog != filepath.Join(p.Logs, "engine.log") || p.Runtime != filepath.Join(root, ".runtime") || p.Engines != filepath.Join(root, ".runtime", "engines") {
		t.Fatalf("unexpected log sidecar: %s", p.EngineLog)
	}
	for _, path := range []string{p.Config, p.DatabaseDir, p.Logs, p.Models, p.Temp, p.Backups, p.Skills, p.MCP, p.Toolcalls, p.Runtime} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("path was created during resolution %q: %v", path, err)
		}
	}
}

func TestResolveDevelopmentLayoutWhenRootDoesNotExist(t *testing.T) {
	workingDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workingDir, "go.mod"), []byte("module test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	p, err := ResolveWithOptions(Options{WorkingDir: workingDir, ExecutablePath: filepath.Join(workingDir, "engine")})
	if err != nil {
		t.Fatalf("development portable resolution failed: %v", err)
	}
	if p.Root != filepath.Join(workingDir, ".portable") || p.Data != filepath.Join(workingDir, ".portable") || p.Layout != "canonical" {
		t.Fatalf("unexpected development paths: %#v", p)
	}
}

func TestResolvePreservesLegacyPortableTree(t *testing.T) {
	root := t.TempDir()
	legacyRoot := filepath.Join(root, ".portable")
	legacyDB := filepath.Join(legacyRoot, "data", "db", "studio.sqlite")
	if err := os.MkdirAll(filepath.Dir(legacyDB), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyDB, []byte("legacy"), 0o600); err != nil {
		t.Fatal(err)
	}
	p, err := ResolveWithOptions(Options{Environment: testEnv(root), WorkingDir: filepath.Join(t.TempDir(), "elsewhere"), ExecutablePath: filepath.Join(root, "AI-Server-Studio.exe")})
	if err != nil {
		t.Fatal(err)
	}
	if !p.UsingLegacy || p.Layout != "legacy" || p.Data != filepath.Join(legacyRoot, "data") || p.Database != legacyDB {
		t.Fatalf("legacy layout not selected: %#v", p)
	}
	if _, err := os.Stat(legacyDB); err != nil {
		t.Fatalf("legacy database was not preserved: %v", err)
	}
}

func TestResolveTreatsLegacyRuntimeAsCompatibilityLayout(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "runtime", "native"), 0o700); err != nil {
		t.Fatal(err)
	}
	p, err := ResolveWithOptions(Options{
		Environment:    testEnv(root),
		WorkingDir:     filepath.Join(t.TempDir(), "elsewhere"),
		ExecutablePath: filepath.Join(root, "AI-Server-Studio.exe"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !p.UsingLegacy || p.Layout != "legacy" || p.LegacyRoot != root || p.Runtime != filepath.Join(root, "runtime") {
		t.Fatalf("legacy runtime layout not selected: %#v", p)
	}
	if p.Database != filepath.Join(root, "data", "db", "studio.sqlite") {
		t.Fatalf("legacy runtime layout selected an unexpected database: %s", p.Database)
	}
}

func TestResolveRejectsDataOutsideExplicitRootAndTraversal(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	env := testEnv(root)
	env[DataDirEnv] = outside
	if _, err := ResolveWithOptions(Options{Environment: env, WorkingDir: root}); err == nil {
		t.Fatal("accepted data directory outside portable root")
	}
	env[DataDirEnv] = filepath.Join(root, "..", "escape")
	if _, err := ResolveWithOptions(Options{Environment: env, WorkingDir: root}); err == nil {
		t.Fatal("accepted data traversal")
	}
}

func TestResolveRejectsInvalidOrSymlinkRoot(t *testing.T) {
	fileRoot := filepath.Join(t.TempDir(), "root-file")
	if err := os.WriteFile(fileRoot, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveWithOptions(Options{Environment: testEnv(fileRoot)}); err == nil {
		t.Fatal("accepted a regular file as portable root")
	}
	if runtime.GOOS != "windows" {
		target := t.TempDir()
		link := filepath.Join(t.TempDir(), "root-link")
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
		if _, err := ResolveWithOptions(Options{Environment: testEnv(link)}); err == nil {
			t.Fatal("accepted a symlink portable root")
		}
	}
}

func TestChildEnvironmentIsScopedAndPortable(t *testing.T) {
	root := t.TempDir()
	p, err := ResolveWithOptions(Options{Environment: testEnv(root)})
	if err != nil {
		t.Fatal(err)
	}
	base := []string{"PATH=keep", "HOME=machine-home", "CUSTOM=value"}
	child := p.ChildEnvironment(base)
	joined := strings.Join(child, "\x00")
	if !strings.Contains(joined, "HOME="+p.Root) || !strings.Contains(joined, "TMP="+p.Temp) || !strings.Contains(joined, "APPDATA="+p.Config) || !strings.Contains(joined, "XDG_CACHE_HOME="+p.Cache) || !strings.Contains(joined, "AIST_MCP_MANIFEST="+p.MCPManifest) || !strings.Contains(joined, "AIST_TOOLCALL_HISTORY_DIR="+p.ToolcallHistory) {
		t.Fatalf("portable child overrides missing: %s", joined)
	}
	if !strings.Contains(joined, "CUSTOM=value") || strings.Contains(joined, "HOME=machine-home") {
		t.Fatalf("child environment did not safely overlay values: %s", joined)
	}
	if base[1] != "HOME=machine-home" {
		t.Fatal("ChildEnvironment mutated caller environment")
	}
}

func TestParentEnvironmentDoesNotRedirectWindowsSystemCaches(t *testing.T) {
	root := t.TempDir()
	p, err := ResolveWithOptions(Options{Environment: testEnv(root)})
	if err != nil {
		t.Fatal(err)
	}
	parent := p.parentEnvironmentValues()
	if _, ok := parent["APPDATA"]; ok {
		t.Fatal("parent environment must not override APPDATA")
	}
	if _, ok := parent["LOCALAPPDATA"]; ok {
		t.Fatal("parent environment must not override LOCALAPPDATA")
	}
	if _, ok := parent["USERPROFILE"]; ok {
		t.Fatal("parent environment must not override USERPROFILE")
	}
	if _, ok := parent[PortableRootEnv]; ok {
		t.Fatal("parent environment must not retain the root-selection override")
	}
	if len(parent) != 0 {
		t.Fatalf("parent environment must remain unchanged: %#v", parent)
	}
}
