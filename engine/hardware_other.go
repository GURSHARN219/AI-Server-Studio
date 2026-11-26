//go:build !windows && !linux && !darwin

package engine

func detectPlatformGPUs() []GPUInfo {
	return nil
}
