declare module 'papaparse' {
  interface ParseResult<T> {
    data: T[];
    errors: any[];
    meta: any;
  }

  function parse<T = any>(
    input: string | File,
    config?: any
  ): ParseResult<T>;

  namespace Papa {
    export { parse, ParseResult };
  }

  export = Papa;
}
