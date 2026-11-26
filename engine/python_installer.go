package engine

import (
	"archive/zip"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"ai-server-studio-backend/portable"
)

// Python embeddable package URLs (Windows x64 only — vLLM is Linux/Windows CUDA)
const (
	pythonVersion  = "3.11.9"
	pythonEmbedURL = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
	getPipURL      = "https://bootstrap.pypa.io/get-pip.py"
)

// PythonInstallProgress is sent to subscribers during installation.
type PythonInstallProgress struct {
	Stage   string  `json:"stage"` // "downloading_python" | "extracting" | "installing_pip" | "installing_vllm" | "done" | "error"
	Message string  `json:"message"`
	Percent float64 `json:"percent"` // 0–100
	Error   string  `json:"error,omitempty"`
}

// PythonInstaller manages the embedded Python installation.
type PythonInstaller struct {
	mu          sync.Mutex
	installDir  string
	pathErr     error
	installing  bool
	subscribers []chan PythonInstallProgress
}

var globalInstaller *PythonInstaller
var installerOnce sync.Once

// GetPythonInstaller returns the singleton installer.
// baseDir should be the directory of the running executable.
func GetPythonInstaller(baseDir string) *PythonInstaller {
	installerOnce.Do(func() {
		_ = baseDir // retained for API compatibility; portable.Resolve owns path selection.
		paths, pathErr := portable.Resolve()
		dir := ""
		if pathErr == nil {
			dir = paths.Python
		}
		globalInstaller = &PythonInstaller{
			installDir: dir,
			pathErr:    pathErr,
		}
	})
	return globalInstaller
}

// PythonExePath returns the path to the embedded python executable, or "" if not installed.
func (p *PythonInstaller) PythonExePath() string {
	if runtime.GOOS == "windows" {
		exe := filepath.Join(p.installDir, "python.exe")
		if _, err := os.Stat(exe); err == nil {
			return exe
		}
	} else {
		exe := filepath.Join(p.installDir, "bin", "python3")
		if _, err := os.Stat(exe); err == nil {
			return exe
		}
	}
	return ""
}

// IsInstalled returns true if embedded Python + vLLM are ready.
func (p *PythonInstaller) IsInstalled() bool {
	if p.pathErr != nil {
		return false
	}
	exe := p.PythonExePath()
	if exe == "" {
		return false
	}
	cmd := exec.Command(exe, "-c", "import vllm")
	paths, err := portable.Resolve()
	if err != nil {
		log.Printf("[python] portable path resolution failed: %v\n", err)
		return false
	}
	cmd.Env = paths.ChildEnvironment(os.Environ())
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[python] vLLM check failed: %s\n", strings.TrimSpace(string(out)))
		return false
	}
	return true
}

// IsInstalling returns true if installation is in progress.
func (p *PythonInstaller) IsInstalling() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.installing
}

// InstallDir returns the installation directory path.
func (p *PythonInstaller) InstallDir() string { return p.installDir }

// Subscribe returns a channel that receives progress updates.
func (p *PythonInstaller) Subscribe() chan PythonInstallProgress {
	p.mu.Lock()
	defer p.mu.Unlock()
	ch := make(chan PythonInstallProgress, 32)
	p.subscribers = append(p.subscribers, ch)
	return ch
}

// Unsubscribe removes a subscriber channel.
func (p *PythonInstaller) Unsubscribe(ch chan PythonInstallProgress) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i, sub := range p.subscribers {
		if sub == ch {
			p.subscribers = append(p.subscribers[:i], p.subscribers[i+1:]...)
			close(ch)
			return
		}
	}
}

func (p *PythonInstaller) broadcast(prog PythonInstallProgress) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, ch := range p.subscribers {
		select {
		case ch <- prog:
		default:
		}
	}
}

// Install downloads Python embeddable + pip + vLLM into installDir.
// Runs asynchronously; subscribe for progress updates.
func (p *PythonInstaller) Install() error {
	p.mu.Lock()
	if p.pathErr != nil {
		err := fmt.Errorf("portable Python runtime path unavailable: %w", p.pathErr)
		p.mu.Unlock()
		return err
	}
	if p.installing {
		p.mu.Unlock()
		return fmt.Errorf("installation already in progress")
	}
	p.installing = true
	p.mu.Unlock()

	go func() {
		defer func() {
			p.mu.Lock()
			p.installing = false
			p.mu.Unlock()
		}()

		if err := p.runInstall(); err != nil {
			log.Printf("[python] Install failed: %v\n", err)
			p.broadcast(PythonInstallProgress{Stage: "error", Error: err.Error(), Message: err.Error()})
		}
	}()

	return nil
}

func (p *PythonInstaller) runInstall() error {
	paths, err := portable.Resolve()
	if err != nil {
		return fmt.Errorf("resolve portable paths: %w", err)
	}
	if err := os.MkdirAll(p.installDir, 0755); err != nil {
		return fmt.Errorf("create install dir: %w", err)
	}

	if runtime.GOOS != "windows" {
		return fmt.Errorf("embedded Python download is only supported on Windows. On Linux/macOS, install Python manually: sudo apt install python3 python3-pip && pip install vllm")
	}

	// ── Step 1: Download Python embeddable zip ─────────────────────────
	p.broadcast(PythonInstallProgress{Stage: "downloading_python", Message: "Downloading Python " + pythonVersion + "...", Percent: 0})

	zipPath := filepath.Join(p.installDir, "python-embed.zip")
	if err := downloadFile(zipPath, pythonEmbedURL, func(pct float64) {
		p.broadcast(PythonInstallProgress{Stage: "downloading_python", Message: fmt.Sprintf("Downloading Python %.0f%%", pct*100), Percent: pct * 0.3})
	}); err != nil {
		return fmt.Errorf("download python: %w", err)
	}

	// ── Step 2: Extract zip ────────────────────────────────────────────
	p.broadcast(PythonInstallProgress{Stage: "extracting", Message: "Extracting Python...", Percent: 30})
	if err := extractZip(zipPath, p.installDir); err != nil {
		return fmt.Errorf("extract python: %w", err)
	}
	os.Remove(zipPath)

	// Enable site-packages in the embeddable distribution
	// The ._pth file disables site by default — we need to uncomment "import site"
	if err := enableSitePackages(p.installDir); err != nil {
		log.Printf("[python] Warning: could not enable site-packages: %v\n", err)
	}

	// ── Step 3: Download get-pip.py ────────────────────────────────────
	p.broadcast(PythonInstallProgress{Stage: "installing_pip", Message: "Installing pip...", Percent: 40})

	getPipPath := filepath.Join(p.installDir, "get-pip.py")
	if err := downloadFile(getPipPath, getPipURL, nil); err != nil {
		return fmt.Errorf("download get-pip: %w", err)
	}

	pythonExe := filepath.Join(p.installDir, "python.exe")
	installPip := exec.Command(pythonExe, getPipPath)
	installPip.Env = paths.ChildEnvironment(os.Environ())
	out, err := installPip.CombinedOutput()
	os.Remove(getPipPath)
	if err != nil {
		return fmt.Errorf("install pip: %w\n%s", err, string(out))
	}
	log.Printf("[python] pip installed\n")

	// ── Step 4: Install vLLM ───────────────────────────────────────────
	p.broadcast(PythonInstallProgress{Stage: "installing_vllm", Message: "Installing vLLM (this takes a few minutes)...", Percent: 55})

	pipExe := filepath.Join(p.installDir, "Scripts", "pip.exe")
	if _, err := os.Stat(pipExe); err != nil {
		pipExe = filepath.Join(p.installDir, "pip.exe")
	}

	cmd := exec.Command(pipExe, "install", "vllm", "--no-warn-script-location")
	cmd.Env = append(paths.ChildEnvironment(os.Environ()), "PYTHONPATH="+p.installDir)
	outPipe, _ := cmd.StdoutPipe()
	errPipe, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start pip install vllm: %w", err)
	}

	// Stream pip output to log
	go pipeToLog("[pip]", outPipe)
	go pipeToLog("[pip]", errPipe)

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("pip install vllm failed: %w", err)
	}

	p.broadcast(PythonInstallProgress{Stage: "done", Message: "Python + vLLM installed successfully.", Percent: 100})
	log.Printf("[python] Installation complete: %s\n", p.installDir)
	return nil
}

// ── FindPython (updated) ───────────────────────────────────────────────

// FindPythonWithInstaller checks embedded Python first, then system PATH.
// baseDir is the directory of the running executable.
func FindPythonWithInstaller(baseDir string) (string, error) {
	installer := GetPythonInstaller(baseDir)

	// 1. Check embedded Python
	if exe := installer.PythonExePath(); exe != "" {
		check := exec.Command(exe, "-c", "import vllm; print(vllm.__version__)")
		paths, pathsErr := portable.Resolve()
		if pathsErr != nil {
			return "", fmt.Errorf("resolve portable paths: %w", pathsErr)
		}
		check.Env = paths.ChildEnvironment(os.Environ())
		out, err := check.Output()
		if err == nil {
			log.Printf("[vLLM] Using embedded Python, vLLM %s\n", strings.TrimSpace(string(out)))
			return exe, nil
		}
	}

	// 2. Fall back to system Python
	return FindPython()
}

// ── Download helpers ───────────────────────────────────────────────────

func downloadFile(dest, url string, progress func(float64)) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()

	total := resp.ContentLength
	var downloaded int64

	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			downloaded += int64(n)
			if progress != nil && total > 0 {
				progress(float64(downloaded) / float64(total))
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func extractZip(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	destAbs, err := filepath.Abs(dest)
	if err != nil {
		return err
	}

	for _, f := range r.File {
		outPath := filepath.Join(dest, filepath.Clean(f.Name))
		// Zip slip guard — ensure extracted path stays within dest
		outAbs, err := filepath.Abs(outPath)
		if err != nil || !strings.HasPrefix(outAbs, destAbs+string(os.PathSeparator)) {
			log.Printf("[extractZip] Skipping unsafe path: %s\n", f.Name)
			continue
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(outPath, 0755)
			continue
		}
		os.MkdirAll(filepath.Dir(outPath), 0755)
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(outPath)
		if err != nil {
			rc.Close()
			return err
		}
		_, copyErr := io.Copy(out, rc)
		out.Close()
		rc.Close()
		if copyErr != nil {
			return copyErr
		}
	}
	return nil
}

// enableSitePackages edits the python3XX._pth file to uncomment "import site"
// which is required for pip-installed packages to be importable.
func enableSitePackages(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), "._pth") {
			pthPath := filepath.Join(dir, e.Name())
			data, err := os.ReadFile(pthPath)
			if err != nil {
				return err
			}
			updated := strings.ReplaceAll(string(data), "#import site", "import site")
			return os.WriteFile(pthPath, []byte(updated), 0644)
		}
	}
	return nil
}
