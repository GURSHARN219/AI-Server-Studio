package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/GURSHARN219/aistclaw/pkg/protocol"
)

// Version is set at build time via -ldflags "-X github.com/GURSHARN219/aistclaw/cmd.Version=v1.0.0"
var Version = "dev"

var (
	cfgFile string
	verbose bool
)

var rootCmd = &cobra.Command{
	Use:   "aistclaw",
	Short: "Aistclaw — AI agent gateway",
	Long:  "Aistclaw: multi-agent AI platform with WebSocket RPC, tool execution, and channel integration. A Go port of OpenClaw with enhanced security and multi-tenant support.",
	Run: func(cmd *cobra.Command, args []string) {
		runGateway()
	},
}

func init() {
	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default: config.json or $AISTCLAW_CONFIG)")
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "enable debug logging")

	rootCmd.AddCommand(onboardCmd())
	rootCmd.AddCommand(versionCmd())
	rootCmd.AddCommand(pairingCmd())
	rootCmd.AddCommand(agentCmd())
	rootCmd.AddCommand(doctorCmd())
	rootCmd.AddCommand(configCmd())
	rootCmd.AddCommand(modelsCmd())
	rootCmd.AddCommand(channelsCmd())
	rootCmd.AddCommand(cronCmd())
	rootCmd.AddCommand(skillsCmd())
	rootCmd.AddCommand(sessionsCmd())
	rootCmd.AddCommand(migrateCmd())
	rootCmd.AddCommand(upgradeCmd())
	rootCmd.AddCommand(authCmd())
}

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print version information",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Printf("aistclaw %s (protocol %d)\n", Version, protocol.ProtocolVersion)
		},
	}
}

func resolveConfigPath() string {
	if cfgFile != "" {
		return cfgFile
	}
	if v := os.Getenv("AISTCLAW_CONFIG"); v != "" {
		return v
	}
	return "config.json"
}

// Execute runs the root cobra command.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
