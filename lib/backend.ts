import { createClient } from "@/lib/supabase/client";

type BackendOperation = "createTransaction" | "createCategory" | "createGoal" | "contributeToGoal";

export async function callBackend<TInput extends object, TOutput>(name: BackendOperation, data: TInput): Promise<TOutput> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase is not configured yet.");

  let result;
  switch (name) {
    case "createTransaction": {
      const input = data as { amountCents: number; description: string; type: "income" | "expense"; categoryId: string };
      result = await supabase.rpc("create_transaction", {
        p_amount_cents: input.amountCents,
        p_description: input.description,
        p_type: input.type,
        p_category_id: input.categoryId === "available" ? null : input.categoryId,
      });
      break;
    }
    case "createCategory": {
      const input = data as { name: string; targetPercent: number; kind: "spending" | "savings" };
      result = await supabase.rpc("create_category", {
        p_name: input.name,
        p_target_percent: input.targetPercent,
        p_kind: input.kind,
      });
      break;
    }
    case "createGoal": {
      const input = data as { name: string; targetCents: number; due: string };
      result = await supabase.rpc("create_goal", {
        p_name: input.name,
        p_target_cents: input.targetCents,
        p_due: input.due || null,
      });
      break;
    }
    case "contributeToGoal": {
      const input = data as { goalId: string; amountCents: number };
      result = await supabase.rpc("contribute_to_goal", {
        p_goal_id: input.goalId,
        p_amount_cents: input.amountCents,
      });
      break;
    }
  }

  if (result.error) throw result.error;
  return result.data as TOutput;
}
