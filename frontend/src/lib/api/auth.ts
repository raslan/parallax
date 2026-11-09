import { req } from "./client";

export interface AuthStatus {
  /** False when the server runs with `PARALLAX_AUTH=off`. */
  enabled: boolean;
  /** An account exists. False means the first visitor still has to create it. */
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface AccountUpdate {
  current_password: string;
  new_username?: string;
  new_password?: string;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const authApi = {
  status: () => req<AuthStatus>("/auth/status"),
  setup: (c: Credentials) => req<AuthStatus>("/auth/setup", json(c)),
  login: (c: Credentials) => req<AuthStatus>("/auth/login", json(c)),
  logout: () => req<void>("/auth/logout", { method: "POST" }),
  logoutAll: () => req<void>("/auth/logout-all", { method: "POST" }),
  updateAccount: (body: AccountUpdate) =>
    req<AuthStatus>("/auth/account", { method: "PATCH", body: JSON.stringify(body) }),
};
