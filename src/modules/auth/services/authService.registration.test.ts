import { beforeEach, describe, expect, it, vi } from "vitest";

const firebaseAuth = vi.hoisted(() => ({
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  deleteUser: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
}));
const callable = vi.hoisted(() => vi.fn());

vi.mock("firebase/auth", () => firebaseAuth);
vi.mock("firebase/functions", () => ({
  httpsCallable: () => callable,
}));
vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
}));
vi.mock("../../../lib/firebase/firebase", () => ({
  auth: {},
  db: {},
  functions: {},
}));
vi.mock("../../audit/services/auditLogService", () => ({
  createAuditLog: vi.fn(),
}));

import {
  registerWithEmail,
  sendAccountRecoveryEmail,
} from "./authService";

describe("registerWithEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseAuth.deleteUser.mockResolvedValue(undefined);
    firebaseAuth.signOut.mockResolvedValue(undefined);
    firebaseAuth.sendPasswordResetEmail.mockResolvedValue(undefined);
  });

  it("offers safe recovery when an orphan Auth account has a different password", async () => {
    firebaseAuth.createUserWithEmailAndPassword.mockRejectedValue({
      code: "auth/email-already-in-use",
    });
    firebaseAuth.signInWithEmailAndPassword.mockRejectedValue({
      code: "auth/invalid-credential",
    });

    await expect(registerWithEmail({
      fullName: "Cont Vechi",
      email: "OLD@example.test",
      password: "different123",
    })).rejects.toMatchObject({
      code: "auth/existing-account-password-mismatch",
      email: "old@example.test",
    });

    expect(callable).not.toHaveBeenCalled();
    expect(firebaseAuth.deleteUser).not.toHaveBeenCalled();
  });

  it("sends recovery to the normalized account email", async () => {
    await sendAccountRecoveryEmail(" OLD@example.test ");

    expect(firebaseAuth.sendPasswordResetEmail).toHaveBeenCalledWith(
      {},
      "old@example.test"
    );
  });

  it("repairs an existing Auth account without deleting it", async () => {
    const credential = { user: { uid: "orphan-user" } };
    firebaseAuth.createUserWithEmailAndPassword.mockRejectedValue({
      code: "auth/email-already-in-use",
    });
    firebaseAuth.signInWithEmailAndPassword.mockResolvedValue(credential);
    callable.mockResolvedValue({ data: { userId: "orphan-user", created: true } });

    await expect(registerWithEmail({
      fullName: "Cont Recuperat",
      email: "ORPHAN@example.test",
      password: "password123",
    })).resolves.toBe(credential);

    expect(firebaseAuth.signInWithEmailAndPassword).toHaveBeenCalledWith(
      {},
      "orphan@example.test",
      "password123"
    );
    expect(firebaseAuth.deleteUser).not.toHaveBeenCalled();
  });

  it("removes a newly created Auth account when profile provisioning fails", async () => {
    const credential = { user: { uid: "new-user" } };
    firebaseAuth.createUserWithEmailAndPassword.mockResolvedValue(credential);
    callable.mockRejectedValue(new Error("profile failed"));

    await expect(registerWithEmail({
      fullName: "Cont Nou",
      email: "new@example.test",
      password: "password123",
    })).rejects.toThrow("profile failed");

    expect(firebaseAuth.deleteUser).toHaveBeenCalledWith(credential.user);
    expect(firebaseAuth.signOut).toHaveBeenCalled();
  });
});
