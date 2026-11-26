package server

import (
	"encoding/base64"
	"os"
	"testing"
)

// Server construction intentionally requires a protected secret in production.
// Keep the package tests hermetic when the developer has not provided one.
func TestMain(m *testing.M) {
	if _, ok := os.LookupEnv("AI_SERVER_SECRET_KEY"); !ok {
		_ = os.Setenv("AI_SERVER_SECRET_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	}
	os.Exit(m.Run())
}
