package engine

import "regexp"

var unsupportedArchitecturePattern = regexp.MustCompile(`unknown model architecture:\s*'([^']+)'`)

func unsupportedArchitectureFromDiagnostic(diagnostic string) string {
	matches := unsupportedArchitecturePattern.FindStringSubmatch(diagnostic)
	if len(matches) != 2 {
		return ""
	}
	return matches[1]
}
