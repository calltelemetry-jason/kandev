package agents

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/kandev/kandev/pkg/agent"
)

func TestCTAgentACP_IDAndDisplay(t *testing.T) {
	a := NewCTAgentACP()
	if got := a.ID(); got != "ctagent-acp" {
		t.Errorf("ID() = %q, want ctagent-acp", got)
	}
	if got := a.Name(); got != "CallTelemetry ctagent ACP Agent" {
		t.Errorf("Name() = %q, want CallTelemetry ctagent ACP Agent", got)
	}
	if got := a.DisplayName(); got != "ctagent" {
		t.Errorf("DisplayName() = %q, want ctagent", got)
	}
	if !a.Enabled() {
		t.Error("Enabled() = false, want true")
	}
	if got := a.DisplayOrder(); got != 23 {
		t.Errorf("DisplayOrder() = %d, want 23", got)
	}
	if got := a.Description(); !strings.Contains(got, "ctagent acp") {
		t.Errorf("Description should mention the ACP launch command, got %q", got)
	}
}

func TestCTAgentACP_AllCommandSurfaces(t *testing.T) {
	a := NewCTAgentACP()
	want := []string{"ctagent", "acp"}

	assertArgvEqual(t, "BuildCommand", a.BuildCommand(CommandOptions{}).Args(), want)

	rt := a.Runtime()
	if rt == nil {
		t.Fatal("Runtime() returned nil")
	}
	if rt.Protocol != agent.ProtocolACP {
		t.Errorf("Runtime.Protocol = %q, want ACP", rt.Protocol)
	}
	assertArgvEqual(t, "Runtime.Cmd", rt.Cmd.Args(), want)

	ic := a.InferenceConfig()
	if ic == nil || !ic.Supported {
		t.Fatalf("InferenceConfig() = %+v, want Supported=true", ic)
	}
	assertArgvEqual(t, "InferenceConfig.Command", ic.Command.Args(), want)

	pa, ok := any(a).(PassthroughAgent)
	if !ok {
		t.Fatal("CTAgentACP must implement PassthroughAgent")
	}
	assertArgvEqual(t, "PassthroughCmd", pa.PassthroughConfig().PassthroughCmd.Args(), []string{"ctagent", "run"})
}

func TestCTAgentACP_RuntimeAndSession(t *testing.T) {
	a := NewCTAgentACP()
	rt := a.Runtime()
	if rt.SessionConfig.SessionDirTemplate != "{home}/.ctagent" {
		t.Errorf("SessionDirTemplate = %q, want {home}/.ctagent", rt.SessionConfig.SessionDirTemplate)
	}
	if rt.SessionConfig.SessionDirTarget != "/root/.ctagent" {
		t.Errorf("SessionDirTarget = %q, want /root/.ctagent", rt.SessionConfig.SessionDirTarget)
	}
	if !rt.SessionConfig.NativeSessionResume {
		t.Error("NativeSessionResume = false, want true")
	}
}

func TestCTAgentACP_Logos(t *testing.T) {
	a := NewCTAgentACP()
	if len(a.Logo(LogoLight)) == 0 {
		t.Error("LogoLight is empty")
	}
	if len(a.Logo(LogoDark)) == 0 {
		t.Error("LogoDark is empty")
	}
	if !slices.Equal(a.Logo(LogoVariant(99)), a.Logo(LogoLight)) {
		t.Error("unknown LogoVariant must fall back to the light logo")
	}
}

func TestCTAgentACP_IsInstalled(t *testing.T) {
	a := NewCTAgentACP()
	res, err := a.IsInstalled(context.Background())
	if err != nil {
		t.Fatalf("IsInstalled: %v", err)
	}
	if !res.Available {
		t.Log("ctagent is not detected on PATH in test environment")
	} else {
		if !res.SupportsMCP {
			t.Error("SupportsMCP = false, want true")
		}
		if !res.Capabilities.SupportsSessionResume {
			t.Error("SupportsSessionResume = false, want true")
		}
	}
}

func TestCTAgentACP_DisplayOrderUnique(t *testing.T) {
	all := []Agent{
		NewClaudeACP(), NewCodexACP(), NewAuggie(), NewOpenCodeACP(),
		NewGemini(), NewCopilotACP(), NewAmpACP(), NewQwenACP(),
		NewIFlowACP(), NewDroidACP(), NewKilocodeACP(), NewPiACP(),
		NewCursorACP(), NewKimiACP(), NewKiroACP(), NewQoderACP(),
		NewTraeACP(), NewOmpACP(), NewDevinACP(), NewGrokACP(),
		NewHermesACP(), NewGooseACP(), NewCTAgentACP(), NewMockAgent(),
	}
	seen := map[int]string{}
	for _, ag := range all {
		order := ag.DisplayOrder()
		if other, exists := seen[order]; exists {
			t.Errorf("DisplayOrder %d collision: %s and %s", order, other, ag.ID())
		}
		seen[order] = ag.ID()
	}
}
