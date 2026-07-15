import type { JsonObject, JsonValue } from '../types.ts';

export class StrictJsonError extends Error {}

class Parser {
  readonly #source: string;
  #index = 0;

  constructor(source: string) {
    this.#source = source;
  }

  parse(): JsonValue {
    this.#skipWhitespace();
    const value = this.#value();
    this.#skipWhitespace();
    if (this.#index !== this.#source.length) {
      throw new StrictJsonError('Trailing JSON input.');
    }
    return value;
  }

  #skipWhitespace(): void {
    while (true) {
      const code = this.#source.charCodeAt(this.#index);
      if (code !== 0x09 && code !== 0x0a && code !== 0x0d && code !== 0x20) {
        break;
      }
      this.#index += 1;
    }
  }

  #value(): JsonValue {
    const token = this.#source[this.#index];
    if (token === '{') return this.#object();
    if (token === '[') return this.#array();
    if (token === '"') return this.#string();
    if (token === 't') return this.#literal('true', true);
    if (token === 'f') return this.#literal('false', false);
    if (token === 'n') return this.#literal('null', null);
    if (token === '-' || /^[0-9]$/u.test(token ?? '')) return this.#number();
    throw new StrictJsonError('Invalid JSON value.');
  }

  #literal<T extends JsonValue>(source: string, value: T): T {
    if (this.#source.slice(this.#index, this.#index + source.length) !== source) {
      throw new StrictJsonError('Invalid JSON literal.');
    }
    this.#index += source.length;
    return value;
  }

  #string(): string {
    const start = this.#index;
    this.#index += 1;
    let escaped = false;
    while (this.#index < this.#source.length) {
      const code = this.#source.charCodeAt(this.#index);
      if (!escaped && code === 0x22) {
        this.#index += 1;
        const token = this.#source.slice(start, this.#index);
        let value: unknown;
        try {
          value = JSON.parse(token);
        } catch {
          throw new StrictJsonError('Invalid JSON string.');
        }
        if (typeof value !== 'string') throw new StrictJsonError('Invalid JSON string.');
        return value;
      }
      if (!escaped && code < 0x20) throw new StrictJsonError('Raw JSON control code.');
      if (!escaped && code === 0x5c) escaped = true;
      else escaped = false;
      this.#index += 1;
    }
    throw new StrictJsonError('Unterminated JSON string.');
  }

  #number(): number {
    const remaining = this.#source.slice(this.#index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(remaining);
    const token = match?.[0];
    if (token === undefined) throw new StrictJsonError('Invalid JSON number.');
    this.#index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) throw new StrictJsonError('Nonfinite JSON number.');
    return value;
  }

  #array(): readonly JsonValue[] {
    this.#index += 1;
    this.#skipWhitespace();
    const values: JsonValue[] = [];
    if (this.#source[this.#index] === ']') {
      this.#index += 1;
      return values;
    }
    while (true) {
      values.push(this.#value());
      this.#skipWhitespace();
      const delimiter = this.#source[this.#index];
      if (delimiter === ']') {
        this.#index += 1;
        return values;
      }
      if (delimiter !== ',') throw new StrictJsonError('Invalid JSON array delimiter.');
      this.#index += 1;
      this.#skipWhitespace();
    }
  }

  #object(): JsonObject {
    this.#index += 1;
    this.#skipWhitespace();
    const value = Object.create(null) as Record<string, JsonValue>;
    const keys = new Set<string>();
    if (this.#source[this.#index] === '}') {
      this.#index += 1;
      return value;
    }
    while (true) {
      if (this.#source[this.#index] !== '"') {
        throw new StrictJsonError('Invalid JSON object key.');
      }
      const key = this.#string();
      if (keys.has(key)) throw new StrictJsonError('Duplicate JSON object key.');
      keys.add(key);
      this.#skipWhitespace();
      if (this.#source[this.#index] !== ':') {
        throw new StrictJsonError('Invalid JSON object delimiter.');
      }
      this.#index += 1;
      this.#skipWhitespace();
      value[key] = this.#value();
      this.#skipWhitespace();
      const delimiter = this.#source[this.#index];
      if (delimiter === '}') {
        this.#index += 1;
        return value;
      }
      if (delimiter !== ',') throw new StrictJsonError('Invalid JSON object delimiter.');
      this.#index += 1;
      this.#skipWhitespace();
    }
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new StrictJsonError('UTF-8 byte-order marks are forbidden.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new StrictJsonError('Input is not canonical UTF-8.');
  }
}

export function parseStrictJsonText(source: string): JsonValue {
  return new Parser(source).parse();
}

export function parseStrictJson(bytes: Uint8Array): JsonValue {
  return parseStrictJsonText(decodeUtf8(bytes));
}

export function parseCanonicalJson(bytes: Uint8Array): JsonValue {
  const source = decodeUtf8(bytes);
  if (!source.endsWith('\n') || source.slice(0, -1).includes('\n')) {
    throw new StrictJsonError('Canonical JSON requires one final line feed.');
  }
  const value = parseStrictJsonText(source.slice(0, -1));
  if (`${JSON.stringify(value)}\n` !== source) {
    throw new StrictJsonError('JSON bytes are not canonical.');
  }
  return value;
}

export function parseCanonicalFixtureJson(bytes: Uint8Array): JsonValue {
  const source = decodeUtf8(bytes);
  const value = parseStrictJsonText(source);
  if (`${JSON.stringify(value, null, 2)}\n` !== source) {
    throw new StrictJsonError('Fixture JSON bytes are not canonical.');
  }
  return value;
}

export function parseCanonicalNdjsonLine(bytes: Uint8Array): JsonValue {
  const source = decodeUtf8(bytes);
  if (!source.endsWith('\n') || source.length === 1) {
    throw new StrictJsonError('NDJSON record requires content and one line feed.');
  }
  const text = source.slice(0, -1);
  if (text.includes('\n') || text.includes('\r')) {
    throw new StrictJsonError('NDJSON record contains a raw line break.');
  }
  const value = parseStrictJsonText(text);
  if (`${JSON.stringify(value)}\n` !== source) {
    throw new StrictJsonError('NDJSON record bytes are not canonical.');
  }
  return value;
}
