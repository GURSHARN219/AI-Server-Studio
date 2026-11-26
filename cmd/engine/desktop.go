package main

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"

	frontend "ai-server-studio-backend"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

func runDesktop(cli cliOptions) error {
	runtime, err := startBackend(cli)
	if err != nil {
		return err
	}

	assets, err := frontend.Files()
	if err != nil {
		log.Printf("[aist] Embedded frontend unavailable: %v", err)
		_ = runtime.shutdown()
		return fmt.Errorf("load embedded frontend: %w", err)
	}
	serverDone := runtime.serve()
	go func() {
		if err := <-serverDone; err != nil {
			log.Printf("[aist] Local API server stopped while desktop was running: %v", err)
		}
	}()

	appOptions := desktopAppOptions(assets, runtime.srv.Handler(), runtime.serverURL, runtime.shutdown)

	log.Printf("[aist] Starting Wails desktop window; local API=%s\n", runtime.serverURL)
	if err := wails.Run(appOptions); err != nil {
		log.Printf("[aist] Wails desktop initialization failed: %v", err)
		_ = runtime.shutdown()
		return fmt.Errorf("run Wails desktop: %w", err)
	}
	return runtime.shutdown()
}

func desktopAppOptions(assets fs.FS, api http.Handler, serverURL string, shutdown func() error) *options.App {
	return &options.App{
		Title:              "AI Server Studio",
		Width:              1440,
		Height:             960,
		MinWidth:           960,
		MinHeight:          640,
		Frameless:          true,
		WindowStartState:   options.Maximised,
		CSSDragProperty:    "--wails-draggable",
		CSSDragValue:       "drag",
		BackgroundColour:   options.NewRGB(16, 18, 24),
		AssetServer:        &assetserver.Options{Assets: assets, Handler: desktopAssetHandler(assets, api)},
		SingleInstanceLock: &options.SingleInstanceLock{UniqueId: "ai-server-studio"},
		Windows:            &windows.Options{WebviewIsTransparent: false, WindowIsTranslucent: false},
		OnStartup: func(_ context.Context) {
			log.Printf("[aist] Wails desktop ready; local API=%s\n", serverURL)
		},
		OnShutdown: func(_ context.Context) {
			if err := shutdown(); err != nil {
				log.Printf("[aist] Desktop shutdown: %v", err)
			}
		},
	}
}

func desktopAssetHandler(assets fs.FS, api http.Handler) http.Handler {
	index, err := fs.ReadFile(assets, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		isAPI := r.URL.Path == "/v1" || strings.HasPrefix(r.URL.Path, "/v1/")
		if err == nil && r.Method == http.MethodGet && !isAPI && strings.Contains(r.Header.Get("Accept"), "text/html") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(index)
			return
		}
		api.ServeHTTP(w, r)
	})
}
