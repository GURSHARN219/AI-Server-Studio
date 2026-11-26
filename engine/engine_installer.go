package engine

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"

	"ai-server-studio-backend/portable"
)

const llamaCppRepo = "ggml-org/llama.cpp"

// variantPatterns maps variant name → GitHub asset filename regex.
// Matches the new llama.cpp release naming: llama-bXXXX-bin-win-cuda-12.4-x64.zip
var variantPatterns = map[string]string{
	"cuda12": `llama-.*-bin-win-cuda-12.*-x64\.zip`,
	"cuda13": `llama-.*-bin-win-cuda-13.*-x64\.zip`,
	"vulkan": `llama-.*-bin-win-vulkan-x64\.zip`,
	"avx2":   `llama-.*-bin-win-cpu-x64\.zip`,
	"metal":  `llama-.*-bin-macos-arm64\.zip`,
	"hip":    `llama-.*-bin-win-hip-radeon-x64\.zip`,
}

// cudartPatterns maps cuda variant → separate cudart zip (CUDA runtime DLLs).
// These must be extracted alongside the main binary.
var cudartPatterns = map[string]string{
	"cuda12": `cudart-llama-bin-win-cuda-12.*-x64\.zip`,
	"cuda13": `cudart-llama-bin-win-cuda-13.*-x64\.zip`,
}

// EngineInstallProgress is sent to subscribers during installation.
type EngineInstallProgress struct {
	Stage   string  `json:"stage"` // "detecting"|"fetching_release"|"downloading"|"extracting"|"done"|"error"
	Message string  `json:"message"`
	Percent float64 `json:"percent"` // 0–100
	Error   string  `json:"error,omitempty"`
}

// EngineInstaller manages downloading and installing the llama-server binary.
type EngineInstaller struct {
	mu          sync.Mutex
	baseDir     string // <exeDir>/bin  — parent of all variant subdirs
	pathErr     error
	installing  bool
	subscribers []chan EngineInstallProgress
}

// binDir returns the root bin directory.
func (e *EngineInstaller) binDir() string { return e.baseDir }

// variantDir returns the isolated subdirectory for a given variant.
// e.g. bin/cuda12, bin/avx2
func (e *EngineInstaller) variantDir(variant string) string {
	return filepath.Join(e.baseDir, variant)
}

var globalEngineInstaller *EngineInstaller
var engineInstallerOnce sync.Once

// GetEngineInstaller returns the singleton installer.
// baseDir should be the directory of the running executable.
func GetEngineInstaller(baseDir string) *EngineInstaller {
	engineInstallerOnce.Do(func() {
		installRoot := filepath.Join(baseDir, ".runtime", "engines")
		var pathErr error
		if paths, err := portable.Resolve(); err == nil {
			if paths.UsingLegacy {
				installRoot = paths.Native
			} else {
				installRoot = paths.Engines
			}
		} else {
			pathErr = err
		}
		globalEngineInstaller = &EngineInstaller{
			baseDir: installRoot,
			pathErr: pathErr,
		}
	})
	return globalEngineInstaller
}

// IsInstalled returns true if llama-server binary exists in any variant subdir or flat bin/.
func (e *EngineInstaller) IsInstalled() bool {
	return e.BinaryPath() != ""
}

// IsInstalling returns true if installation is in progress.
func (e *EngineInstaller) IsInstalling() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.installing
}

// InstalledVariant returns the variant from the marker file, or "".
func (e *EngineInstaller) InstalledVariant() string {
	v, _ := e.readMarker()
	return v
}

// InstalledVersion returns the version from the marker file, or "".
func (e *EngineInstaller) InstalledVersion() string {
	_, ver := e.readMarker()
	return ver
}

// BinaryPath returns the absolute path to llama-server(.exe), or "" if not found.
// Checks variant subdir first (bin/<variant>/), then flat bin/ for backwards compat.
func (e *EngineInstaller) BinaryPath() string {
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	name := "llama-server" + ext

	// Check variant subdir first (e.g. bin/cuda12/llama-server.exe)
	variant, _ := e.readMarker()
	if variant != "" {
		p := filepath.Join(e.variantDir(variant), name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	// Fallback: flat bin/llama-server.exe (legacy layout)
	p := filepath.Join(e.baseDir, name)
	if _, err := os.Stat(p); err == nil {
		return p
	}
	return ""
}

// BinDir returns the directory containing the active llama-server binary, or the base bin dir.
func (e *EngineInstaller) BinDir() string {
	if p := e.BinaryPath(); p != "" {
		return filepath.Dir(p)
	}
	return e.baseDir
}

// RecommendedVariant returns the best variant string for the detected GPU.
func (e *EngineInstaller) RecommendedVariant() string {
	backend, _, _, cudaMajor := BestGPUBackend(false)
	switch backend {
	case GPUBackendCUDA:
		if cudaMajor >= 13 {
			return "cuda13"
		}
		return "cuda12"
	case GPUBackendVulkan, GPUBackendROCm:
		return "vulkan"
	case GPUBackendMetal:
		return "metal"
	default:
		return "avx2"
	}
}

// Subscribe returns a channel that receives progress updates.
func (e *EngineInstaller) Subscribe() chan EngineInstallProgress {
	e.mu.Lock()
	defer e.mu.Unlock()
	ch := make(chan EngineInstallProgress, 32)
	e.subscribers = append(e.subscribers, ch)
	return ch
}

// Unsubscribe removes a subscriber channel.
func (e *EngineInstaller) Unsubscribe(ch chan EngineInstallProgress) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for i, sub := range e.subscribers {
		if sub == ch {
			e.subscribers = append(e.subscribers[:i], e.subscribers[i+1:]...)
			close(ch)
			return
		}
	}
}

func (e *EngineInstaller) broadcast(p EngineInstallProgress) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, ch := range e.subscribers {
		select {
		case ch <- p:
		default:
		}
	}
}

// Install starts an async installation of the given variant.
// Pass "auto" to auto-detect the best variant.
func (e *EngineInstaller) Install(variant string) error {
	e.mu.Lock()
	if e.pathErr != nil {
		err := fmt.Errorf("portable engine runtime path unavailable: %w", e.pathErr)
		e.mu.Unlock()
		return err
	}
	if e.installing {
		e.mu.Unlock()
		return fmt.Errorf("installation already in progress")
	}
	e.installing = true
	e.mu.Unlock()

	go func() {
		defer func() {
			e.mu.Lock()
			e.installing = false
			e.mu.Unlock()
		}()
		if err := e.runInstall(variant); err != nil {
			log.Printf("[EngineInstaller] Install failed: %v\n", err)
			e.broadcast(EngineInstallProgress{Stage: "error", Error: err.Error(), Message: err.Error()})
		}
	}()
	return nil
}

func (e *EngineInstaller) runInstall(variant string) error {
	// ── Step 1: Detect variant ─────────────────────────────────────────
	if variant == "auto" || variant == "" {
		e.broadcast(EngineInstallProgress{Stage: "detecting", Message: "Detecting GPU hardware...", Percent: 2})
		variant = e.RecommendedVariant()
		log.Printf("[EngineInstaller] Auto-detected variant: %s\n", variant)
	}

	pattern, ok := variantPatterns[variant]
	if !ok {
		// Fallback to avx2 if unknown variant
		log.Printf("[EngineInstaller] Unknown variant %q, falling back to avx2\n", variant)
		variant = "avx2"
		pattern = variantPatterns["avx2"]
	}

	e.broadcast(EngineInstallProgress{Stage: "fetching_release", Message: fmt.Sprintf("Fetching latest llama.cpp release (variant: %s)...", variant), Percent: 5})

	// ── Step 2: Fetch latest release from GitHub ───────────────────────
	release, err := fetchLatestRelease()
	if err != nil {
		return fmt.Errorf("fetch release: %w", err)
	}
	log.Printf("[EngineInstaller] Latest release: %s\n", release.TagName)

	asset := findMatchingAsset(release, pattern)
	if asset == nil {
		// Fallback to avx2
		log.Printf("[EngineInstaller] No asset matched %q, falling back to avx2\n", pattern)
		e.broadcast(EngineInstallProgress{Stage: "fetching_release", Message: "GPU variant not found, falling back to CPU (avx2)...", Percent: 8})
		variant = "avx2"
		asset = findMatchingAsset(release, variantPatterns["avx2"])
	}
	if asset == nil {
		return fmt.Errorf("no matching asset found in release %s", release.TagName)
	}

	log.Printf("[EngineInstaller] Downloading asset: %s\n", asset.Name)

	// ── Step 3: Download zip into variant-isolated subdir ─────────────
	destDir := e.variantDir(variant)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("create variant dir: %w", err)
	}

	zipPath := filepath.Join(e.baseDir, "llama-server-download.zip")
	defer os.Remove(zipPath)

	e.broadcast(EngineInstallProgress{Stage: "downloading", Message: fmt.Sprintf("Downloading %s...", asset.Name), Percent: 10})

	if err := downloadFile(zipPath, asset.URL, func(pct float64) {
		e.broadcast(EngineInstallProgress{
			Stage:   "downloading",
			Message: fmt.Sprintf("Downloading %s (%.0f%%)...", asset.Name, pct*100),
			Percent: 10 + pct*70, // 10–80%
		})
	}); err != nil {
		return fmt.Errorf("download asset: %w", err)
	}

	// ── Step 4: Extract llama-server + DLLs into variant subdir ──────
	e.broadcast(EngineInstallProgress{Stage: "extracting", Message: "Extracting binaries...", Percent: 82})

	if err := extractLlamaServer(zipPath, destDir); err != nil {
		return fmt.Errorf("extract: %w", err)
	}

	// ── Step 4b: Get CUDA runtime DLLs (CUDA variants only) ──────────
	if _, ok := cudartPatterns[variant]; ok {
		// Try copying from local CUDA toolkit first (fast, no download needed)
		if !copyCudartFromSystem(destDir) {
			// Fall back to downloading the cudart zip
			cudartAsset := findMatchingAsset(release, cudartPatterns[variant])
			if cudartAsset != nil {
				e.broadcast(EngineInstallProgress{Stage: "extracting", Message: "Downloading CUDA runtime DLLs...", Percent: 88})
				cudartZip := filepath.Join(e.baseDir, "cudart-download.zip")
				defer os.Remove(cudartZip)
				if err := downloadFile(cudartZip, cudartAsset.URL, func(pct float64) {
					e.broadcast(EngineInstallProgress{
						Stage:   "extracting",
						Message: fmt.Sprintf("Downloading CUDA runtime (%.0f%%)...", pct*100),
						Percent: 88 + pct*7,
					})
				}); err != nil {
					log.Printf("[EngineInstaller] Warning: cudart download failed: %v\n", err)
				} else if err := extractLlamaServer(cudartZip, destDir); err != nil {
					log.Printf("[EngineInstaller] Warning: cudart extract failed: %v\n", err)
				} else {
					log.Printf("[EngineInstaller] CUDA runtime DLLs extracted from zip\n")
				}
			}
		}
	}

	// ── Step 5: Write variant marker into variant subdir ──────────────
	if err := e.writeMarker(variant, release.TagName, asset.Name); err != nil {
		log.Printf("[EngineInstaller] Warning: could not write marker: %v\n", err)
	}

	e.broadcast(EngineInstallProgress{Stage: "done", Message: fmt.Sprintf("llama-server installed (%s %s)", variant, release.TagName), Percent: 100})
	log.Printf("[EngineInstaller] Installation complete: %s\n", e.variantDir(variant))
	return nil
}

// ── GitHub API helpers ─────────────────────────────────────────────────

type githubRelease struct {
	TagName string        `json:"tag_name"`
	Assets  []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

func fetchLatestRelease() (*githubRelease, error) {
	url := "https://api.github.com/repos/" + llamaCppRepo + "/releases/latest"
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "ai-server-studio/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}
	return &release, nil
}

func findMatchingAsset(r *githubRelease, pattern string) *githubAsset {
	re, err := regexp.Compile("(?i)" + pattern)
	if err != nil {
		return nil
	}
	for i := range r.Assets {
		if re.MatchString(r.Assets[i].Name) {
			return &r.Assets[i]
		}
	}
	return nil
}

// ── Extraction ─────────────────────────────────────────────────────────

// extractLlamaServer extracts llama-server(.exe) and all .dll files from the zip.
func extractLlamaServer(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	serverName := "llama-server" + ext

	extracted := 0
	binaryFound := false
	for _, f := range r.File {
		name := filepath.Base(f.Name)
		lower := strings.ToLower(name)

		// Extract exe, DLLs, shared libs, and any bundled JSON configs
		if name == serverName ||
			strings.HasSuffix(lower, ".dll") ||
			strings.HasSuffix(lower, ".so") ||
			strings.HasSuffix(lower, ".dylib") ||
			strings.HasSuffix(lower, ".json") {
			if f.FileInfo().IsDir() {
				continue
			}
			outPath := filepath.Join(destDir, name)
			if err := extractFile(f, outPath); err != nil {
				log.Printf("[EngineInstaller] Warning: could not extract %s: %v\n", name, err)
				if name == serverName {
					return fmt.Errorf("failed to extract llama-server binary: %w", err)
				}
				continue
			}
			if name == serverName {
				binaryFound = true
			}
			log.Printf("[EngineInstaller] Extracted: %s\n", name)
			extracted++
		}
	}

	if !binaryFound {
		return fmt.Errorf("llama-server binary not found or failed to extract")
	}
	return nil
}

func extractFile(f *zip.File, destPath string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	out, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, rc)
	return err
}

// ── Marker file ────────────────────────────────────────────────────────

func (e *EngineInstaller) writeMarker(variant, version, asset string) error {
	data := map[string]string{
		"variant": variant,
		"version": version,
		"asset":   asset,
	}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	// Write into the variant subdir so it travels with the binaries
	return os.WriteFile(filepath.Join(e.variantDir(variant), "llama-server-variant.json"), b, 0644)
}

func (e *EngineInstaller) readMarker() (variant, version string) {
	// Check all known variant subdirs for a marker using a stable priority
	priority := []string{"cuda13", "cuda12", "vulkan", "hip", "metal", "avx2"}
	for _, v := range priority {
		data, err := os.ReadFile(filepath.Join(e.variantDir(v), "llama-server-variant.json"))
		if err != nil {
			continue
		}
		var m struct {
			Variant string `json:"variant"`
			Version string `json:"version"`
		}
		if json.Unmarshal(data, &m) == nil && m.Variant != "" {
			return m.Variant, m.Version
		}
	}
	// Fallback: flat bin/ marker (legacy)
	data, err := os.ReadFile(filepath.Join(e.baseDir, "llama-server-variant.json"))
	if err != nil {
		return "", ""
	}
	var m struct {
		Variant string `json:"variant"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return "", ""
	}
	return m.Variant, m.Version
}

// copyCudartFromSystem tries to copy CUDA runtime DLLs from the local CUDA
// toolkit installation into destDir. Returns true if at least one DLL was copied.
// This avoids downloading the 380MB cudart zip when CUDA is already installed.
func copyCudartFromSystem(destDir string) bool {
	// Common CUDA toolkit bin locations (Windows)
	cudaVersions := []string{"v12.8", "v12.6", "v12.4", "v12.3", "v12.2", "v12.1", "v12.0", "v13.0", "v11.8"}
	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		programFiles = `C:\Program Files`
	}

	var srcDir string
	for _, ver := range cudaVersions {
		candidate := filepath.Join(programFiles, "NVIDIA GPU Computing Toolkit", "CUDA", ver, "bin")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			srcDir = candidate
			break
		}
	}
	if srcDir == "" {
		log.Println("[EngineInstaller] CUDA toolkit not found locally — will download cudart")
		return false
	}

	log.Printf("[EngineInstaller] Copying CUDA runtime DLLs from: %s\n", srcDir)

	// DLLs needed by ggml-cuda.dll
	needed := []string{
		"cublas64_12.dll", "cublasLt64_12.dll", "cudart64_12.dll",
		"cublas64_11.dll", "cublasLt64_11.dll", "cudart64_110.dll", // CUDA 11 fallback names
	}

	copied := 0
	for _, dll := range needed {
		src := filepath.Join(srcDir, dll)
		if _, err := os.Stat(src); err != nil {
			continue
		}
		dst := filepath.Join(destDir, dll)
		if err := copyFileSimple(src, dst); err != nil {
			log.Printf("[EngineInstaller] Warning: could not copy %s: %v\n", dll, err)
			continue
		}
		log.Printf("[EngineInstaller] Copied from system: %s\n", dll)
		copied++
	}
	return copied > 0
}

func copyFileSimple(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
