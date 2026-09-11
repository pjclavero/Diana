/**
 * Puertos de la autoridad de credenciales MQTT (T4).
 *
 * Dos puertos y no uno, porque son dos autoridades distintas y conviene que se
 * puedan sustituir por separado:
 *
 *  - QUIÉN puede existir  → `IdentitySourcePort`. La fuente única es
 *    `infrastructure/mosquitto/identities.json`, y la única forma admitida de
 *    consultarla es el generador canónico `generate-identities.mjs`. No se
 *    reimplementa aquí ni se parsea el JSON a mano: un segundo lector acaba
 *    divergiendo del que genera la ACL, y entonces existe una credencial que
 *    ninguna regla de autorización respalda.
 *  - DÓNDE vive el secreto → `MqttCredentialStorePort`. Hoy, el fichero
 *    `passwd` de Mosquitto. El backend nunca guarda la contraseña: la entrega
 *    al broker y se queda con un hash bcrypt propio para poder verificarla.
 */

export const IDENTITY_SOURCE = Symbol('IDENTITY_SOURCE');
export const MQTT_CREDENTIAL_STORE = Symbol('MQTT_CREDENTIAL_STORE');

export interface IdentitySourcePort {
  /** Usuarios declarados en la fuente única. */
  listUsernames(): Promise<string[]>;
  /**
   * `module_id` que corresponde a un usuario declarado, o `null` si el usuario
   * no está en la fuente. Con `identity_equals_module_id=true` (F-02) coincide
   * con el propio usuario, pero se pregunta al generador en vez de asumirlo:
   * si algún día la fuente los desacopla, aquí no hay que tocar nada.
   */
  moduleIdOf(username: string): Promise<string | null>;
  /** De dónde se leyó, para poder decirlo en un error. */
  describe(): string;
}

export interface MqttCredentialStorePort {
  /**
   * Da de alta o rota el secreto de `username` en el almacén del broker.
   *
   * El secreto viaja como argumento de función y NUNCA por `argv`: quien
   * implemente esto contra un binario externo debe pasarlo por stdin. `ps` es
   * legible por cualquier usuario del host.
   */
  upsert(username: string, secret: string): Promise<void>;
  /** Retira la credencial del broker. */
  remove(username: string): Promise<void>;
  describe(): string;
}
