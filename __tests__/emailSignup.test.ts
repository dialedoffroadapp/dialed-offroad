// lib/emailSignup.ts: the email auth sequence extracted from app/signup.tsx.
// Each status below is one of the screen's original branches, transcribed.
const signUp = jest.fn();
const signInWithPassword = jest.fn();
jest.mock("../lib/supabase", () => ({
  supabase: { auth: { signUp: (...a: any[]) => signUp(...a), signInWithPassword: (...a: any[]) => signInWithPassword(...a) } },
}));

/* eslint-disable import/first */
import { isAlreadyRegisteredMessage, signUpWithEmail, validateEmailSignup } from "../lib/emailSignup";

beforeEach(() => {
  signUp.mockReset();
  signInWithPassword.mockReset();
});

test("validation: same messages as the screen, trimmed inputs", () => {
  expect(validateEmailSignup("nope", "")).toEqual({ ok: false, emailErr: "Enter a valid email.", pwErr: "Password is required." });
  expect(validateEmailSignup("  rider@example.com ", "   ")).toMatchObject({ ok: false, emailErr: "", pwErr: "Password is required." });
  expect(validateEmailSignup("rider@example.com", "hunter22")).toEqual({ ok: true, emailErr: "", pwErr: "" });
});

test("already-registered detection covers the three Supabase wordings", () => {
  expect(isAlreadyRegisteredMessage("User already registered")).toBe(true);
  expect(isAlreadyRegisteredMessage("This email has already been registered")).toBe(true);
  expect(isAlreadyRegisteredMessage("user already exists")).toBe(true);
  expect(isAlreadyRegisteredMessage("Network request failed")).toBe(false);
  expect(isAlreadyRegisteredMessage(undefined)).toBe(false);
});

test("new account: signUp then signIn; identities present → isNewAccount true; inputs trimmed", async () => {
  signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [{ id: "i1" }] } }, error: null });
  signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  await expect(signUpWithEmail(" rider@example.com ", " pw ")).resolves.toEqual({ status: "created", userId: "u1", isNewAccount: true });
  expect(signUp).toHaveBeenCalledWith({ email: "rider@example.com", password: "pw" });
  expect(signInWithPassword).toHaveBeenCalledWith({ email: "rider@example.com", password: "pw" });
});

test("enumeration protection: signUp ok with empty identities is a returning rider (isNewAccount false)", async () => {
  signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [] } }, error: null });
  signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  await expect(signUpWithEmail("rider@example.com", "pw")).resolves.toMatchObject({ status: "created", isNewAccount: false });
});

test("already registered + matching password → recovered with the user id", async () => {
  signUp.mockResolvedValue({ data: null, error: { message: "User already registered" } });
  signInWithPassword.mockResolvedValue({ data: { user: { id: "u-old" } }, error: null });
  await expect(signUpWithEmail("rider@example.com", "pw")).resolves.toEqual({ status: "recovered", userId: "u-old" });
});

test("already registered + wrong password → exists_wrong_password (no throw)", async () => {
  signUp.mockResolvedValue({ data: null, error: { message: "User already registered" } });
  signInWithPassword.mockResolvedValue({ data: null, error: { message: "Invalid login credentials" } });
  await expect(signUpWithEmail("rider@example.com", "pw")).resolves.toEqual({ status: "exists_wrong_password" });
});

test("account created but auto sign-in failed → created_signin_failed", async () => {
  signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [{}] } }, error: null });
  signInWithPassword.mockResolvedValue({ data: null, error: { message: "boom" } });
  await expect(signUpWithEmail("rider@example.com", "pw")).resolves.toEqual({ status: "created_signin_failed" });
});

test("any other signUp error surfaces its message; a thrown error is caught", async () => {
  signUp.mockResolvedValue({ data: null, error: { message: "Network request failed" } });
  await expect(signUpWithEmail("rider@example.com", "pw")).resolves.toEqual({ status: "error", message: "Network request failed" });
  signUp.mockRejectedValue(new Error("offline"));
  await expect(signUpWithEmail("rider@example.com", "pw")).resolves.toEqual({ status: "error", message: "offline" });
  expect(signInWithPassword).not.toHaveBeenCalled();
});
