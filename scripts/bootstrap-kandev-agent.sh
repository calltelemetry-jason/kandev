#!/usr/bin/env bash
# bootstrap-kandev-agent.sh — Initialize KanDev agent environment with Bifrost MCP & ct-skills
#
# Sets up:
# 1. MCP configuration (.mcp.json) pointing to Bifrost MCP gateway with virtual key auth
# 2. Local CLI tool `ct-skill` for querying ct-meta skills directly from shell
# 3. Validates connectivity to Bifrost LLM gateway and MCP endpoints
#
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BOLD}${BLUE}=== KanDev Agent Bootstrap ===${NC}"

# 1. Resolve Gateway URLs and Credentials
BIFROST_MCP_URL="${CT_BIFROST_MCP_URL:-http://ct-llm-gateway-bifrost.ct-llm-gateway.svc.cluster.local/mcp}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://ct-llm-gateway-bifrost.ct-llm-gateway.svc.cluster.local/v1}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
TARGET_HOME="${HOME:-/root}"

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo -e "${RED}[ERROR] OPENAI_API_KEY is not set. KanDev virtual key credential required.${NC}" >&2
  exit 1
fi

KEY_PREFIX="${OPENAI_API_KEY:0:9}..."
echo -e "[bootstrap] Virtual Key detected: ${GREEN}${KEY_PREFIX}${NC}"
echo -e "[bootstrap] Bifrost MCP URL: ${BIFROST_MCP_URL}"
echo -e "[bootstrap] OpenAI Base URL: ${OPENAI_BASE_URL}"

# 2. Verify Bifrost MCP Reachability
echo -n "[bootstrap] Probing Bifrost MCP gateway... "
PROBE_RESPONSE=$(curl -s -m 5 -X POST "${BIFROST_MCP_URL}" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' || true)

TOOL_COUNT=0
if command -v jq >/dev/null 2>&1; then
  TOOL_COUNT=$(echo "${PROBE_RESPONSE}" | jq '.result.tools | length' 2>/dev/null || echo "0")
elif command -v node >/dev/null 2>&1; then
  TOOL_COUNT=$(echo "${PROBE_RESPONSE}" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(d).result?.tools?.length||0)}catch(e){console.log(0)}})' 2>/dev/null || echo "0")
elif command -v python3 >/dev/null 2>&1; then
  TOOL_COUNT=$(echo "${PROBE_RESPONSE}" | python3 -c 'import sys, json; print(len(json.load(sys.stdin).get("result", {}).get("tools", [])))' 2>/dev/null || echo "0")
fi

if [ "${TOOL_COUNT}" -gt 0 ]; then
  echo -e "${GREEN}OK (${TOOL_COUNT} tools registered)${NC}"
else
  echo -e "${YELLOW}WARNING (could not parse tools count, probe raw response: $(echo "${PROBE_RESPONSE}" | head -c 120))${NC}"
fi

# 3. Generate MCP Configuration Files
mkdir -p "${WORKSPACE_DIR}"

cat <<EOF > "${WORKSPACE_DIR}/.mcp.json"
{
  "mcpServers": {
    "bifrost": {
      "type": "http",
      "url": "${BIFROST_MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${OPENAI_API_KEY}"
      }
    }
  }
}
EOF
echo -e "[bootstrap] Wrote ${WORKSPACE_DIR}/.mcp.json"

# Claude Code / Cursor / Pi compatibility
if [ -d "${TARGET_HOME}" ] && [ -w "${TARGET_HOME}" ]; then
  mkdir -p "${TARGET_HOME}/.claude"
  cp "${WORKSPACE_DIR}/.mcp.json" "${TARGET_HOME}/.claude/mcp.json" 2>/dev/null || true
  mkdir -p "${WORKSPACE_DIR}/.cursor"
  cp "${WORKSPACE_DIR}/.mcp.json" "${WORKSPACE_DIR}/.cursor/mcp.json" 2>/dev/null || true
  mkdir -p "${WORKSPACE_DIR}/.pi"
  cp "${WORKSPACE_DIR}/.mcp.json" "${WORKSPACE_DIR}/.pi/mcp.json" 2>/dev/null || true
fi

# 4. Install `ct-skill` CLI Helper
INSTALL_DIR="/usr/local/bin"
if [ ! -w "${INSTALL_DIR}" ]; then
  INSTALL_DIR="${WORKSPACE_DIR}/bin"
  mkdir -p "${INSTALL_DIR}"
  export PATH="${INSTALL_DIR}:${PATH}"
fi

CT_SKILL_BIN="${INSTALL_DIR}/ct-skill"

cat <<'EOF' > "${CT_SKILL_BIN}"
#!/usr/bin/env bash
# ct-skill — CLI for querying and inspecting ct-meta skills via Bifrost MCP
set -euo pipefail

BIFROST_URL="${CT_BIFROST_MCP_URL:-http://ct-llm-gateway-bifrost.ct-llm-gateway.svc.cluster.local/mcp}"
API_KEY="${OPENAI_API_KEY:-}"

if [ -z "${API_KEY}" ]; then
  echo "Error: OPENAI_API_KEY virtual key is required." >&2
  exit 1
fi

json_rpc_call() {
  local tool_name="$1"
  local args_json="$2"
  local payload

  if command -v jq >/dev/null 2>&1; then
    payload=$(jq -n \
      --arg name "$tool_name" \
      --argjson args "$args_json" \
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":$name,"arguments":$args}}')
  elif command -v node >/dev/null 2>&1; then
    payload=$(node -e 'console.log(JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:process.argv[1],arguments:JSON.parse(process.argv[2])}}))' "$tool_name" "$args_json")
  else
    payload="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"${tool_name}\",\"arguments\":${args_json}}}"
  fi

  curl -s -X POST "${BIFROST_URL}" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "${payload}"
}

parse_text_output() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.result.content[0].text // .result // .error.message // .'
  elif command -v node >/dev/null 2>&1; then
    node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{let j=JSON.parse(d);console.log(j.result?.content?.[0]?.text||j.result||j.error?.message||d)}catch(e){console.log(d)}})'
  else
    cat
  fi
}

cmd="${1:-help}"
case "${cmd}" in
  search)
    query="${2:-}"
    if [ -z "${query}" ]; then
      echo "Usage: ct-skill search <query>" >&2
      exit 1
    fi
    res=$(json_rpc_call "ct_skills-ct_skills_search" "{\"query\":\"${query}\"}")
    echo "${res}" | parse_text_output
    ;;
  get)
    name="${2:-}"
    if [ -z "${name}" ]; then
      echo "Usage: ct-skill get <skill-name>" >&2
      exit 1
    fi
    res=$(json_rpc_call "ct_skills-ct_skills_get" "{\"name\":\"${name}\"}")
    echo "${res}" | parse_text_output
    ;;
  list)
    res=$(json_rpc_call "ct_skills-ct_skills_list" "{}")
    echo "${res}" | parse_text_output
    ;;
  probe)
    res=$(curl -s -X POST "${BIFROST_URL}" \
      -H "Authorization: Bearer ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
    if command -v jq >/dev/null 2>&1; then
      echo "${res}" | jq -r '.result.tools[].name' | sed 's/^/  - /'
    elif command -v node >/dev/null 2>&1; then
      echo "${res}" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{let j=JSON.parse(d);j.result?.tools?.forEach(t=>console.log("  - "+t.name))})'
    else
      echo "${res}"
    fi
    ;;
  *)
    echo "Usage: ct-skill [command] [args]"
    echo ""
    echo "Commands:"
    echo "  search <query>    Search ct-meta skills by keyword or topic"
    echo "  get <skill-name>  Retrieve complete SKILL.md specification"
    echo "  list              List all available ct-meta skills"
    echo "  probe             List all active Bifrost MCP tools"
    ;;
esac
EOF

chmod +x "${CT_SKILL_BIN}"
echo -e "[bootstrap] Installed CLI helper to ${GREEN}${CT_SKILL_BIN}${NC}"

echo -e "${BOLD}${GREEN}=== KanDev Agent Bootstrap Complete ===${NC}"
