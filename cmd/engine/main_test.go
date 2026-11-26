package main

import (
	"bytes"
	"errors"
	"flag"
	"strings"
	"testing"
)

func TestParseCLIDefaultsToGUIAndSupportedRuntimeFlags(t *testing.T) {
	options, err := parseCLI([]string{"--port", "0", "--ctx", "8192", "--cpu", "--model", "model.gguf", "--models-dir", "models"})
	if err != nil {
		t.Fatal(err)
	}
	if options.server || options.vllm || !options.cpu || options.port != 0 || options.ctx != 8192 || options.model != "model.gguf" || options.modelsDir != "models" {
		t.Fatalf("unexpected CLI options: %+v", options)
	}
}

func TestParseCLIRequiresServerForVLLM(t *testing.T) {
	_, err := parseCLI([]string{"--vllm"})
	if err == nil || !strings.Contains(err.Error(), "--vllm requires --server") {
		t.Fatalf("error = %v, want actionable vLLM dependency error", err)
	}
}

func TestParseCLIValidatesPortAndContext(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "negative port", args: []string{"--port", "-1"}, want: "invalid --port"},
		{name: "large port", args: []string{"--port", "65536"}, want: "invalid --port"},
		{name: "zero context", args: []string{"--ctx", "0"}, want: "invalid --ctx"},
		{name: "large context", args: []string{"--ctx", "131073"}, want: "invalid --ctx"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parseCLI(tc.args)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want substring %q", err, tc.want)
			}
		})
	}
}

func TestParseCLIRemovesLegacyDevelopmentFlags(t *testing.T) {
	for _, name := range []string{"--browser", "--no-open", "--embedded"} {
		_, err := parseCLI([]string{name})
		if err == nil || !strings.Contains(err.Error(), "flag provided but not defined") {
			t.Fatalf("%s error = %v, want unknown-flag error", name, err)
		}
	}
}

func TestParseCLIHelpReturnsFlagHelp(t *testing.T) {
	_, err := parseCLI([]string{"--help"})
	if !errors.Is(err, flag.ErrHelp) {
		t.Fatalf("error = %v, want flag.ErrHelp", err)
	}
}

func TestParseCLIVersionReturnsWithoutStartingRuntime(t *testing.T) {
	options, err := parseCLI([]string{"--version"})
	if err != nil {
		t.Fatal(err)
	}
	if !options.version || options.server {
		t.Fatalf("unexpected version options: %+v", options)
	}
}

func TestUsageAndVersionOutputContainCLIInformation(t *testing.T) {
	var usage bytes.Buffer
	printUsage(&usage)
	for _, expected := range []string{"--server", "--help, -h", "--version", "--port", "Examples:"} {
		if !strings.Contains(usage.String(), expected) {
			t.Fatalf("usage output missing %q: %s", expected, usage.String())
		}
	}

	var version bytes.Buffer
	printVersion(&version)
	for _, expected := range []string{"AI Server Studio", "Git commit:", "Build date:"} {
		if !strings.Contains(version.String(), expected) {
			t.Fatalf("version output missing %q: %s", expected, version.String())
		}
	}
}

func TestDesktopModeDoesNotExposeLegacyBrowserFlags(t *testing.T) {
	if options, err := parseCLI(nil); err != nil || options.server {
		t.Fatalf("default mode = %+v, err = %v; want desktop mode", options, err)
	}
}
