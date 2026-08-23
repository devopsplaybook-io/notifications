import * as bcrypt from "bcrypt";
import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelTracer } from "../OTelContext";
import { User } from "../model/User";

export async function UserPasswordSetPassword(
  context: Span,
  user: User,
  password: string,
): Promise<void> {
  const span = OTelTracer().startSpan("UserPasswordSetPassword", context);
  try {
    const saltRounds = 10;
    user.passwordEncrypted = await bcrypt.hash(password, saltRounds);
  } finally {
    span.end();
  }
}

export async function UserPasswordCheckPassword(
  context: Span,
  user: User,
  password: string,
): Promise<boolean> {
  const span = OTelTracer().startSpan("UserPasswordCheckPassword", context);
  try {
    return await bcrypt.compare(password, user.passwordEncrypted);
  } finally {
    span.end();
  }
}
