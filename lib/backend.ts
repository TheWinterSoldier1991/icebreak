import { httpsCallable } from "firebase/functions";
import { getFirebaseClient } from "@/lib/firebase";

export async function callBackend<TInput extends object, TOutput>(name: string, data: TInput): Promise<TOutput> {
  const client = getFirebaseClient();
  if (!client) throw new Error("Firebase is not configured yet.");
  const callable = httpsCallable<TInput, TOutput>(client.functions, name);
  const result = await callable(data);
  return result.data;
}
