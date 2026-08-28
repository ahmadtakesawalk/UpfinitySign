// DEPLOY TO: lib/signing/formula.ts
// Evaluates a formula field's expression against other fields' current
// values. Hand-rolled recursive-descent parser — NOT eval()/Function():
// the expression is sender-authored input, and eval-ing arbitrary strings
// is a real injection surface worth just not having.
//
// Supports:
//  - Arithmetic: + - * / and parentheses
//  - Comparisons: < > <= >= <>  (not-equal) — evaluate to 1 (true) or 0
//    (false), not chained (`a < b < c` is not valid, same as most formula
//    languages in this class of tool)
//  - Field references by id
//  - A small set of built-in functions, case-insensitive:
//      TODAY()                 current date, as days-since-epoch
//      DAY(date) / MONTH(date) / YEAR(date)   calendar components of a date value
//      DAYS_IN_MONTH(date)     number of days in that date's month
//      MIN(a, b) / MAX(a, b)   smaller/larger of two values
//      ROUND(value, decimals)  rounds to a fixed number of decimal places
//
// Date handling: this parser has no separate "date" type — a date-typed
// field's value must be converted by the CALLER into days-since-epoch
// (Math.floor(dateMs / 86_400_000), UTC) before being passed in via
// `fieldValues`, same as every other field. Arithmetic on two such values
// (e.g. `move_out - move_in`) naturally yields a day count; the date
// functions above exist for the cases that aren't pure arithmetic — e.g.
// pro-rated rent: `monthly_rent * (DAYS_IN_MONTH(move_in) - DAY(move_in) + 1) / DAYS_IN_MONTH(move_in)`.

export class FormulaError extends Error {}

type Token =
  | { type: "num"; value: number }
  | { type: "id"; value: string }
  | { type: "op"; value: string };

const MULTI_CHAR_OPS = ["<=", ">=", "<>"];
const COMPARISON_OPS = ["<", ">", "<=", ">=", "<>"];

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      const numStr = expr.slice(i, j);
      const value = Number(numStr);
      if (Number.isNaN(value)) throw new FormulaError(`Invalid number: "${numStr}"`);
      tokens.push({ type: "num", value });
      i = j;
    } else if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++;
      tokens.push({ type: "id", value: expr.slice(i, j) });
      i = j;
    } else {
      const two = expr.slice(i, i + 2);
      if (MULTI_CHAR_OPS.includes(two)) {
        tokens.push({ type: "op", value: two });
        i += 2;
        continue;
      }
      if ("+-*/(),<>".includes(ch)) {
        tokens.push({ type: "op", value: ch });
        i++;
      } else {
        throw new FormulaError(`Unexpected character in formula: "${ch}"`);
      }
    }
  }
  return tokens;
}

const MS_PER_DAY = 86_400_000;

// Interprets a days-since-epoch number as a UTC calendar date — UTC
// specifically so DAY()/MONTH()/YEAR() give a stable answer independent of
// the server's local timezone.
function epochDayToDate(days: number): Date {
  return new Date(Math.round(days) * MS_PER_DAY);
}

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  TODAY: (args) => {
    if (args.length !== 0) throw new FormulaError("TODAY() takes no arguments");
    return Math.floor(Date.now() / MS_PER_DAY);
  },
  DAY: (args) => {
    if (args.length !== 1) throw new FormulaError("DAY() takes exactly one argument");
    return epochDayToDate(args[0]).getUTCDate();
  },
  MONTH: (args) => {
    if (args.length !== 1) throw new FormulaError("MONTH() takes exactly one argument");
    return epochDayToDate(args[0]).getUTCMonth() + 1;
  },
  YEAR: (args) => {
    if (args.length !== 1) throw new FormulaError("YEAR() takes exactly one argument");
    return epochDayToDate(args[0]).getUTCFullYear();
  },
  DAYS_IN_MONTH: (args) => {
    if (args.length !== 1) throw new FormulaError("DAYS_IN_MONTH() takes exactly one argument");
    const d = epochDayToDate(args[0]);
    // Day 0 of the *next* month is the last calendar day of the target month.
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  },
  MIN: (args) => {
    if (args.length !== 2) throw new FormulaError("MIN() takes exactly two arguments");
    return Math.min(args[0], args[1]);
  },
  MAX: (args) => {
    if (args.length !== 2) throw new FormulaError("MAX() takes exactly two arguments");
    return Math.max(args[0], args[1]);
  },
  ROUND: (args) => {
    if (args.length !== 2) throw new FormulaError("ROUND() takes exactly two arguments (value, decimals)");
    const [value, decimals] = args;
    const factor = Math.pow(10, Math.round(decimals));
    return Math.round(value * factor) / factor;
  },
};

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private values: Record<string, number>) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private consume(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new FormulaError("Unexpected end of formula");
    this.pos++;
    return t;
  }

  // Top level: a single optional comparison wrapping the additive level.
  parseExpr(): number {
    const lhs = this.parseAdditive();
    const next = this.peek();
    if (next?.type === "op" && COMPARISON_OPS.includes(next.value)) {
      const op = this.consume().value;
      const rhs = this.parseAdditive();
      switch (op) {
        case "<": return lhs < rhs ? 1 : 0;
        case ">": return lhs > rhs ? 1 : 0;
        case "<=": return lhs <= rhs ? 1 : 0;
        case ">=": return lhs >= rhs ? 1 : 0;
        case "<>": return lhs !== rhs ? 1 : 0;
      }
    }
    return lhs;
  }

  private parseAdditive(): number {
    let value = this.parseTerm();
    while (this.peek()?.type === "op" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const op = this.consume().value;
      const rhs = this.parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    while (this.peek()?.type === "op" && (this.peek()!.value === "*" || this.peek()!.value === "/")) {
      const op = this.consume().value;
      const rhs = this.parseFactor();
      if (op === "/" && rhs === 0) throw new FormulaError("Division by zero");
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }

  private parseFactor(): number {
    const t = this.consume();
    if (t.type === "num") return t.value;
    if (t.type === "id") {
      // A name immediately followed by "(" is a function call, not a
      // field reference — checked here (not in the tokenizer) so the
      // tokenizer stays a single simple pass with no lookahead.
      if (this.peek()?.type === "op" && this.peek()!.value === "(") {
        return this.parseFunctionCall(t.value);
      }
      if (!(t.value in this.values)) throw new FormulaError(`Formula references unknown field: "${t.value}"`);
      return this.values[t.value];
    }
    if (t.type === "op" && t.value === "(") {
      const value = this.parseExpr();
      const close = this.consume();
      if (close.value !== ")") throw new FormulaError("Missing closing parenthesis");
      return value;
    }
    if (t.type === "op" && t.value === "-") return -this.parseFactor();
    throw new FormulaError(`Unexpected token in formula: "${t.value}"`);
  }

  private parseFunctionCall(name: string): number {
    const fn = FUNCTIONS[name.toUpperCase()];
    if (!fn) throw new FormulaError(`Unknown function: "${name}"`);
    this.consume(); // "("
    const args: number[] = [];
    if (!(this.peek()?.type === "op" && this.peek()!.value === ")")) {
      args.push(this.parseExpr());
      while (this.peek()?.type === "op" && this.peek()!.value === ",") {
        this.consume();
        args.push(this.parseExpr());
      }
    }
    const close = this.consume();
    if (close.value !== ")") throw new FormulaError(`Missing closing parenthesis in call to "${name}"`);
    return fn(args);
  }
}

export function evaluateFormula(expression: string, fieldValues: Record<string, number>): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens, fieldValues);
  const result = parser.parseExpr();
  if ((parser as any).pos !== tokens.length) throw new FormulaError("Unexpected trailing tokens in formula");
  return result;
}
