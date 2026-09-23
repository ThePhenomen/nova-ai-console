const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parsePath = (path: string): Array<string | number> =>
  path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));

export const getAt = (root: unknown, path: string): unknown => {
  let current: unknown = root;
  for (const part of parsePath(path)) {
    if (typeof part === 'number') {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[part];
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
};

export const setAt = (root: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = parsePath(path);
  let current: Record<string, unknown> | unknown[] = root;
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    const nextPart = parts[index + 1];
    if (isLast) {
      if (Array.isArray(current) && typeof part === 'number') {
        current[part] = value;
        return;
      }
      if (isRecord(current) && typeof part === 'string') {
        if (value === '' || value === undefined) {
          delete current[part];
        } else {
          current[part] = value;
        }
      }
      return;
    }
    if (Array.isArray(current) && typeof part === 'number') {
      if (current[part] === undefined) {
        current[part] = typeof nextPart === 'number' ? [] : {};
      }
      current = current[part] as Record<string, unknown> | unknown[];
      return;
    }
    if (isRecord(current) && typeof part === 'string') {
      if (!isRecord(current[part]) && !Array.isArray(current[part])) {
        current[part] = typeof nextPart === 'number' ? [] : {};
      }
      current = current[part] as Record<string, unknown> | unknown[];
    }
  });
};

export const cloneResource = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const needsQuote = (value: string): boolean =>
  value === '' ||
  /[:#{}[\],&*?|<>=!%@`']/.test(value) ||
  value.includes('\n') ||
  value.trim() !== value;

const dumpYaml = (value: unknown, indent = 0): string => {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return needsQuote(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return value
      .map((item) => {
        if (isRecord(item) || Array.isArray(item)) {
          const inner = dumpYaml(item, 0);
          return inner
            .split('\n')
            .map((line, index) => (index === 0 ? `${pad}- ${line}` : `${pad}  ${line}`))
            .join('\n');
        }
        return `${pad}- ${dumpYaml(item, 0)}`;
      })
      .join('\n');
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '{}';
    }
    return entries
      .map(([key, nested]) => {
        if (nested === undefined) {
          return null;
        }
        if (isRecord(nested) || Array.isArray(nested)) {
          const inner = dumpYaml(nested, indent + 1);
          if (inner === '{}' || inner === '[]') {
            return `${pad}${key}: ${inner}`;
          }
          return `${pad}${key}:\n${inner}`;
        }
        return `${pad}${key}: ${dumpYaml(nested, 0)}`;
      })
      .filter((line): line is string => line !== null)
      .join('\n');
  }
  return JSON.stringify(value);
};

export const toManifest = (resource: Record<string, unknown>): string => `${dumpYaml(resource)}\n`;

const parseScalar = (raw: string): unknown => {
  const value = raw.trim();
  if (value === '' || value === 'null' || value === '~') {
    return null;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
};

type YamlFrame = { indent: number; value: Record<string, unknown> | unknown[] };

export const parseManifest = (text: string): Record<string, unknown> => {
  const trimmed = text.trim().replace(/^---\s*/, '');
  if (!trimmed) {
    throw new Error('Manifest is empty.');
  }
  if (trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      throw new Error('JSON manifest must be an object.');
    }
    return parsed;
  }

  const root: Record<string, unknown> = {};
  const stack: YamlFrame[] = [{ indent: -1, value: root }];
  let pending: { indent: number; key: string; parent: Record<string, unknown> } | null = null;

  const frameAt = (): YamlFrame => stack[stack.length - 1] ?? { indent: -1, value: root };

  trimmed.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) {
      return;
    }
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const content = line.trim();
    const isList = content.startsWith('- ') || content === '-';

    while (stack.length > 1 && indent <= frameAt().indent) {
      stack.pop();
    }

    if (pending && indent > pending.indent) {
      if (isList) {
        const next: unknown[] = [];
        pending.parent[pending.key] = next;
        stack.push({ indent: pending.indent, value: next });
      } else {
        const next: Record<string, unknown> = {};
        pending.parent[pending.key] = next;
        stack.push({ indent: pending.indent, value: next });
      }
      pending = null;
    } else {
      pending = null;
    }

    if (isList) {
      const frame = frameAt();
      if (!Array.isArray(frame.value)) {
        throw new Error(`Invalid list at line ${lineIndex + 1}.`);
      }
      const rest = content === '-' ? '' : content.slice(2).trim();
      if (rest === '' || rest.includes(':')) {
        const item: Record<string, unknown> = {};
        frame.value.push(item);
        stack.push({ indent, value: item });
        if (rest.includes(':')) {
          const colon = rest.indexOf(':');
          const key = rest.slice(0, colon).trim();
          const valueText = rest.slice(colon + 1).trim();
          if (valueText === '') {
            pending = { indent, key, parent: item };
          } else {
            item[key] = parseScalar(valueText);
          }
        }
        return;
      }
      frame.value.push(parseScalar(rest));
      return;
    }

    const colon = content.indexOf(':');
    if (colon < 0) {
      throw new Error(`Invalid mapping at line ${lineIndex + 1}.`);
    }
    const key = content.slice(0, colon).trim();
    const valueText = content.slice(colon + 1).trim();
    const frame = frameAt();
    if (Array.isArray(frame.value)) {
      throw new Error(`Expected mapping at line ${lineIndex + 1}.`);
    }
    if (valueText === '' || valueText === '|' || valueText === '>') {
      pending = { indent, key, parent: frame.value };
      return;
    }
    if (valueText === '[]') {
      frame.value[key] = [];
      return;
    }
    if (valueText === '{}') {
      frame.value[key] = {};
      return;
    }
    frame.value[key] = parseScalar(valueText);
  });

  return root;
};
