//nolint:dupl,goconst // Native-binary ACP agents follow the same minimal scaffold; differences are the binary name, argv, and auth surface.
package agents

import (
	"context"
	_ "embed"
	"os/exec"
	"strings"
	"time"

	"github.com/kandev/kandev/internal/agent/usage"
	"github.com/kandev/kandev/pkg/agent"
)

//go:embed logos/ctagent_light.svg
var ctagentLogoLight []byte

//go:embed logos/ctagent_dark.svg
var ctagentLogoDark []byte

const (
	ctagentBin    = "ctagent"
	ctagentAltBin = "ct-agent"
)

var (
	_ Agent            = (*CTAgentACP)(nil)
	_ PassthroughAgent = (*CTAgentACP)(nil)
	_ InferenceAgent   = (*CTAgentACP)(nil)
	_ LoginAgent       = (*CTAgentACP)(nil)
)

// CTAgentACP implements Agent for CallTelemetry's ctagent coding agent operator
// using native ACP over stdin/stdout (`ctagent acp`).
type CTAgentACP struct {
	StandardPassthrough
}

func NewCTAgentACP() *CTAgentACP {
	return &CTAgentACP{
		StandardPassthrough: StandardPassthrough{
			PermSettings: emptyPermSettings,
			Cfg: PassthroughConfig{
				Supported:      true,
				Label:          "CLI Passthrough",
				Description:    "Show terminal directly instead of chat interface",
				PassthroughCmd: NewCommand(ctagentBin, "run"),
				ModelFlag:      NewParam("--model", "{model}"),
				IdleTimeout:    3 * time.Second,
				BufferMaxBytes: DefaultBufferMaxBytes,
			},
		},
	}
}

func (a *CTAgentACP) ID() string          { return "ctagent-acp" }
func (a *CTAgentACP) Name() string        { return "CallTelemetry ctagent ACP Agent" }
func (a *CTAgentACP) DisplayName() string { return "ctagent" }
func (a *CTAgentACP) Description() string {
	return "CallTelemetry autonomous coding agent operator using the ACP protocol via ctagent acp."
}
func (a *CTAgentACP) Enabled() bool     { return true }
func (a *CTAgentACP) DisplayOrder() int { return 23 }

func (a *CTAgentACP) Logo(v LogoVariant) []byte {
	if v == LogoDark {
		return ctagentLogoDark
	}
	return ctagentLogoLight
}

func (a *CTAgentACP) IsInstalled(ctx context.Context) (*DiscoveryResult, error) {
	result, err := Detect(ctx, detectCTAgent)
	if err != nil {
		return result, err
	}
	result.SupportsMCP = true
	result.Capabilities = DiscoveryCapabilities{
		SupportsSessionResume: true,
	}
	return result, nil
}

func detectCTAgent(ctx context.Context) (bool, string, error) {
	path, err := exec.LookPath(ctagentBin)
	if err != nil {
		path, err = exec.LookPath(ctagentAltBin)
		if err != nil {
			return false, "", nil
		}
	}

	checkCtx, cancel := context.WithTimeout(ctx, commandCheckTimeout)
	defer cancel()
	output, err := exec.CommandContext(checkCtx, path, "acp", "--help").CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return false, "", ctx.Err()
		}
		return false, "", nil
	}

	help := strings.ToLower(string(output))
	if !strings.Contains(help, "acp") {
		return false, "", nil
	}
	return true, path, nil
}

func (a *CTAgentACP) BuildCommand(_ CommandOptions) Command {
	return Cmd(ctagentBin, "acp").Build()
}

func (a *CTAgentACP) Runtime() *RuntimeConfig {
	canRecover := true
	return &RuntimeConfig{
		Cmd:            Cmd(ctagentBin, "acp").Build(),
		WorkingDir:     "{workspace}",
		Env:            map[string]string{},
		ResourceLimits: DefaultResourceLimits,
		Protocol:       agent.ProtocolACP,
		SessionConfig: SessionConfig{
			NativeSessionResume: true,
			CanRecover:          &canRecover,
			SessionDirTemplate:  "{home}/.ctagent",
			SessionDirTarget:    "/root/.ctagent",
		},
	}
}

func (a *CTAgentACP) RemoteAuth() *RemoteAuth {
	return &RemoteAuth{
		Methods: []RemoteAuthMethod{
			{
				Type:  "files",
				Label: "Copy ctagent config files",
				SourceFiles: map[string][]string{
					"darwin": {".config/calltelemetry/llm-gateway.sh"},
					"linux":  {".config/calltelemetry/llm-gateway.sh"},
				},
				TargetRelDir: ".config/calltelemetry",
			},
		},
	}
}

func (a *CTAgentACP) LoginCommand() *LoginCommand {
	return &LoginCommand{
		Cmd:         []string{ctagentBin, "version"},
		Description: "Verify ctagent installation and version.",
	}
}

func (a *CTAgentACP) InstallScript() string {
	return "ctagent self-update || curl -fsSL https://calltelemetry.com/install.sh | bash"
}

func (a *CTAgentACP) PermissionSettings() map[string]PermissionSetting {
	return emptyPermSettings
}

func (a *CTAgentACP) InferenceConfig() *InferenceConfig {
	return &InferenceConfig{
		Supported: true,
		Command:   NewCommand(ctagentBin, "acp"),
	}
}

func (a *CTAgentACP) BillingType() usage.BillingType { return defaultBillingType() }
