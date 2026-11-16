interface Line {
  start: number;
}

/** Index of the last line that has started at `time`; -1 before the first. */
export function currentLineIndex(lines: Line[], time: number): number {
  let current = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i]?.start ?? Infinity) <= time) current = i;
    else break;
  }
  return current;
}
