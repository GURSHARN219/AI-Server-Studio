package main

import (
	_ "time/tzdata" // embed IANA timezone database for containers without tzdata

	"github.com/GURSHARN219/aistclaw/cmd"
)

func main() {
	cmd.Execute()
}
