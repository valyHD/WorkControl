import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
} from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const useFirebaseEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";

const firebaseConfig = {
  apiKey: useFirebaseEmulators ? "demo-api-key" : "AIzaSyA-BrafynGDV7I7IOH5UEb53DErNzWXp5s",
  authDomain: useFirebaseEmulators
    ? "demo-workcontrol.firebaseapp.com"
    : "workcontrol-53b1d.firebaseapp.com",
  projectId: useFirebaseEmulators ? "demo-workcontrol" : "workcontrol-53b1d",
  storageBucket: useFirebaseEmulators
    ? "demo-workcontrol.appspot.com"
    : "workcontrol-53b1d.firebasestorage.app",
  messagingSenderId: "366357316965",
  appId: "1:366357316965:web:f4bbd6a0395a2b5317cd8c",
  measurementId: "G-JFB58C8PTV",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true,
  localCache: memoryLocalCache(),
});

export const storage = getStorage(app);
export const functions = getFunctions(app, "europe-west1");

const emulatorFlag = "__workcontrolFirebaseEmulatorsConnected";
const globalState = globalThis as typeof globalThis & Record<string, unknown>;

if (useFirebaseEmulators && !globalState[emulatorFlag]) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  globalState[emulatorFlag] = true;
}

export default app;
