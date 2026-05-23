import axios, { type AxiosInstance, type AxiosResponse, isAxiosError } from 'axios';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { BrokerCredentials } from '@algo/shared-types';

/**
 * REST client for the Motilal Oswal OpenAPI (v3/v5/v7 endpoints documented at
 * https://invest.motilaloswal.com/moAPI/APIDocumentation/Introduction).
 *
 * Headers required on EVERY call (per docs §2): Accept, User-Agent, ApiKey, apisecretkey,
 * accesstoken, Authorization, vendorinfo, ClientLocalIp/PublicIp, MacAddress, SourceId, osname,
 * osversion, devicemodel, manufacturer, productname, productversion.
 *
 * Auth flow (per docs §1):
 *   1. POST /rest/login/v7/authdirectapi with { userid, password=SHA256(password+apikey), 2FA, totp }
 *      → returns AuthToken (this is what goes into the Authorization header).
 *   2. POST /rest/login/v1/getaccesstoken with the AuthToken as Authorization
 *      → returns accesstoken (this is what goes into the `accesstoken` header).
 *   3. All subsequent calls use BOTH AuthToken (Authorization) AND accesstoken header.
 */
const PROD_BASE = 'https://openapi.motilaloswal.com';
const UAT_BASE = 'http://uattrade.motilaloswal.com:83';

export type MotilalEnv = 'prod' | 'uat';

export type MotilalHttpOptions = {
  apiKey: string;
  apiSecretKey: string;
  vendorInfo?: string;
  /** "prod" hits openapi.motilaloswal.com; "uat" hits uattrade. */
  env?: MotilalEnv;
};

export class MotilalHttp {
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly apiSecretKey: string;
  private readonly vendorInfo: string;
  private authToken: string | undefined;
  private accessToken: string | undefined;
  private readonly clientIp: string;
  private readonly macAddress: string;

  constructor(opts: MotilalHttpOptions) {
    this.apiKey = opts.apiKey;
    this.apiSecretKey = opts.apiSecretKey;
    this.vendorInfo = opts.vendorInfo ?? '';
    this.clientIp = pickLocalIp();
    this.macAddress = pickMac();
    this.client = axios.create({
      baseURL: opts.env === 'uat' ? UAT_BASE : PROD_BASE,
      timeout: 20_000,
    });
  }

  /** Step 1+2 of auth. After this call, `this.authToken` and `this.accessToken` are populated. */
  async authenticate(creds: BrokerCredentials): Promise<{ authToken: string; accessToken: string }> {
    if (!creds.clientCode) throw new Error('Motilal: clientCode (userid) required');
    if (!creds.password) throw new Error('Motilal: password required');
    if (!creds.twoFA) throw new Error('Motilal: twoFA (PAN or DOB) required');

    // SHA-256(password + apikey), hex-encoded uppercase per common Indian-broker convention.
    const hashed = createHash('sha256').update(creds.password + this.apiKey).digest('hex');

    const loginResp = await this.client.post(
      '/rest/login/v7/authdirectapi',
      {
        userid: creds.clientCode,
        password: hashed,
        '2FA': creds.twoFA,
        totp: creds.totpSecret ?? '',
      },
      { headers: this.headersForLogin() },
    );
    const loginData = unwrap(loginResp);
    const authToken = (loginData.AuthToken ?? loginData.authToken) as string | undefined;
    if (!authToken) {
      throw new Error(`Motilal login failed: ${JSON.stringify(loginResp.data)}`);
    }
    this.authToken = authToken;

    const accessResp = await this.client.post(
      '/rest/login/v1/getaccesstoken',
      {},
      { headers: this.headersForAuthed() },
    );
    const accessData = unwrap(accessResp);
    const accessToken = (accessData.accesstoken ?? accessData.AccessToken) as string | undefined;
    if (!accessToken) {
      throw new Error(`Motilal getaccesstoken failed: ${JSON.stringify(accessResp.data)}`);
    }
    this.accessToken = accessToken;
    return { authToken, accessToken };
  }

  /** Restore tokens from a previously cached session (skip login). */
  loadSession(tokens: { authToken: string; accessToken: string }): void {
    this.authToken = tokens.authToken;
    this.accessToken = tokens.accessToken;
  }

  hasSession(): boolean {
    return Boolean(this.authToken && this.accessToken);
  }

  getTokens(): { authToken: string; accessToken: string } | null {
    if (!this.authToken || !this.accessToken) return null;
    return { authToken: this.authToken, accessToken: this.accessToken };
  }

  /** Generic authed POST against the Motilal API. */
  async post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    if (!this.authToken || !this.accessToken) {
      throw new Error('Motilal: not authenticated (call authenticate first)');
    }
    try {
      const resp = await this.client.post<T>(path, body, { headers: this.headersForAuthed() });
      return unwrap(resp) as T;
    } catch (err) {
      if (isAxiosError(err)) {
        const msg = err.response?.data ?? err.message;
        throw new Error(`Motilal POST ${path} failed: ${JSON.stringify(msg)}`);
      }
      throw err;
    }
  }

  /** Generic authed GET. Used for the scrip-master CSV download. */
  async getText(path: string, query: Record<string, string | number> = {}): Promise<string> {
    if (!this.authToken || !this.accessToken) {
      throw new Error('Motilal: not authenticated');
    }
    const resp = await this.client.get<string>(path, {
      params: query,
      headers: this.headersForAuthed(),
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    return resp.data;
  }

  // ----------------------------------------------------------------- Headers
  private headersForLogin(): Record<string, string> {
    return {
      Accept: 'application/json',
      'User-Agent': 'MOSL/V.1.1.0',
      ApiKey: this.apiKey,
      apisecretkey: this.apiSecretKey,
      vendorinfo: this.vendorInfo,
      MacAddress: this.macAddress,
      ClientLocalIp: this.clientIp,
      ClientPublicIp: this.clientIp,
      SourceId: 'WEB',
      osname: 'Windows',
      osversion: '10',
      devicemodel: 'AHV',
      manufacturer: 'DELL',
      productname: 'AlgoTradePlatform',
      productversion: '1.0',
      browsername: 'Chrome',
      browserversion: '120.0',
    };
  }

  private headersForAuthed(): Record<string, string> {
    return {
      ...this.headersForLogin(),
      Authorization: this.authToken ?? '',
      accesstoken: this.accessToken ?? '',
    };
  }
}

function unwrap(resp: AxiosResponse): { [k: string]: unknown } {
  if (typeof resp.data !== 'object' || resp.data === null) {
    throw new Error(`Motilal API returned non-JSON body: ${String(resp.data).slice(0, 200)}`);
  }
  const body = resp.data as { status?: string; message?: string };
  if (body.status && body.status !== 'SUCCESS' && body.status !== 'success') {
    throw new Error(`Motilal API error: ${body.message ?? JSON.stringify(body)}`);
  }
  return body as { [k: string]: unknown };
}

function pickLocalIp(): string {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return '127.0.0.1';
}

function pickMac(): string {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list ?? []) {
      if (n.mac && n.mac !== '00:00:00:00:00:00') return n.mac;
    }
  }
  return '00:00:00:00:00:00';
}
