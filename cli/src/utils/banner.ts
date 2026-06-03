import pc from "picocolors";

const SLAW_ART = [
  "███████╗██╗      █████╗ ██╗    ██╗",
  "██╔════╝██║     ██╔══██╗██║    ██║",
  "███████╗██║     ███████║██║ █╗ ██║",
  "╚════██║██║     ██╔══██║██║███╗██║",
  "███████║███████╗██║  ██║╚███╔███╔╝",
  "╚══════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ",
] as const;

const TAGLINE = "Simple Localised Agent Workforce";

export function printSlawCliBanner(): void {
  const lines = [
    "",
    ...SLAW_ART.map((line) => pc.cyan(line)),
    pc.blue("  ───────────────────────────────────────────────────────"),
    pc.bold(pc.white(`  ${TAGLINE}`)),
    "",
  ];

  console.log(lines.join("\n"));
}
