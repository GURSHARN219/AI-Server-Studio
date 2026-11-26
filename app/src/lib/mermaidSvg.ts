const NUMBER = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/;
const ARITY: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
};

function skipSeparators(value: string, index: number): number {
  while (index < value.length && (value[index] === "," || /\s/.test(value[index]))) index += 1;
  return index;
}

function validPathData(value: string): boolean {
  let index = 0;
  let command = "";

  while (true) {
    index = skipSeparators(value, index);
    if (index >= value.length) return command !== "";

    const token = value[index];
    if (/[a-zA-Z]/.test(token)) {
      command = token.toLowerCase();
      index += 1;
      if (command === "z") continue;
      if (!(command in ARITY)) return false;
    } else if (!command || command === "z") {
      return false;
    }

    const arity = ARITY[command];
    let values = 0;
    while (true) {
      index = skipSeparators(value, index);
      if (index >= value.length || /[a-zA-Z]/.test(value[index])) break;
      const match = value.slice(index).match(NUMBER);
      if (!match) return false;
      values += 1;
      index += match[0].length;
    }

    if (values === 0 || values % arity !== 0) return false;
    // Additional coordinate pairs after M/m are implicit L/l commands.
    if (command === "m") command = "l";
  }
}

/**
 * Reject Mermaid output that would make the browser parse malformed SVG path
 * data. The raw SVG is only inserted after every path has passed this check.
 */
export function validateMermaidSvg(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.querySelector("parsererror")) {
    throw new Error("Mermaid generated invalid SVG");
  }

  for (const path of Array.from(document.querySelectorAll("path[d]"))) {
    const d = path.getAttribute("d");
    if (!d || !validPathData(d)) {
      throw new Error("Mermaid generated invalid SVG path data");
    }
  }
  return svg;
}
