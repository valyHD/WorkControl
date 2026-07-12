import { useCallback, useEffect, useState } from "react";
import {
  SpeechRecognitionController,
  type SpeechRecognitionControllerOptions,
} from "./speechRecognitionController";

export function useSpeechRecognitionController(options: SpeechRecognitionControllerOptions = {}) {
  const [controller] = useState(() => new SpeechRecognitionController(options));
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());

  useEffect(() => {
    controller.updateOptions(options);
  }, [controller, options]);

  useEffect(() => controller.subscribe(setSnapshot), [controller]);
  useEffect(() => () => controller.dispose(), [controller]);

  const press = useCallback(() => controller.press(), [controller]);
  const release = useCallback(() => controller.release(), [controller]);
  const cancel = useCallback(() => controller.cancel(), [controller]);

  return { ...snapshot, press, release, cancel };
}
