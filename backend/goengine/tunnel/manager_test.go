package tunnel

import (
	"os"
	"testing"
)

func TestNewFromEnvIsDisabledByDefault(t *testing.T) {
	t.Setenv("AI_SERVER_TUNNEL_ENABLED", "")
	t.Setenv("AI_SERVER_TUNNEL_PROVIDER", "")
	m := NewFromEnv("4567")
	status := m.Status()
	if status.Enabled || status.Running || status.PublicURL != "" {
		t.Fatalf("unexpected default tunnel state: %+v", status)
	}
}

func TestNewFromEnvConfiguresSupportedProviderWithoutLeakingSecrets(t *testing.T) {
	t.Setenv("AI_SERVER_TUNNEL_ENABLED", "1")
	t.Setenv("AI_SERVER_TUNNEL_PROVIDER", "cloudflare")
	t.Setenv("TUNNEL_TOKEN", "do-not-log")
	m := NewFromEnv("4567")
	if m.provider != ProviderCloudflare || m.target != "http://127.0.0.1:4567" {
		t.Fatalf("unexpected manager configuration: %+v", m)
	}
	if status := m.Status(); !status.Enabled || status.Running || status.PublicURL != "" {
		t.Fatalf("unexpected configured state: %+v", status)
	}
	if _, ok := os.LookupEnv("TUNNEL_TOKEN"); !ok {
		t.Fatal("test setup lost tunnel credential")
	}
}
