export class User {
  id = "";
  name = "";
  passwordEncrypted = "";
  /** Sessions/tokens issued for this user are invalidated when this grows. */
  tokenVersion = 0;
}
