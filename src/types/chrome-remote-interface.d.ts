/**
 * Type shim for `chrome-remote-interface`.
 *
 * The package ships no type definitions. The CDP domains (Runtime, Network,
 * DOM, Page, Debugger) are entirely dynamic — each exposes command methods
 * `(params?) => Promise<result>` and event registrars `(cb) => void`. We type
 * them permissively (`any`) so full-strict type-checking passes without trying
 * to model the whole protocol.
 */
declare module "chrome-remote-interface" {
  /** A CDP domain — command methods and event registrars, all dynamic. */
  type CDPDomain = {
    [method: string]: any;
  };

  export interface Client {
    Runtime: CDPDomain;
    Network: CDPDomain;
    DOM: CDPDomain;
    Page: CDPDomain;
    Debugger: CDPDomain;
    on(event: string, listener: (...args: any[]) => void): void;
    close(): Promise<void>;
    [key: string]: any;
  }

  export interface CDPOptions {
    host?: string;
    port?: number;
    /** URL substring, target id, or a picker function over the target list. */
    target?: string | ((targets: any[]) => any);
    [key: string]: any;
  }

  function CDP(options?: CDPOptions): Promise<Client>;

  export default CDP;
}
