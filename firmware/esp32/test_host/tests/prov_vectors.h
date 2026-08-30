/* GENERADO por firmware/esp32/tools/gen_prov_vectors.py - NO EDITAR.
 * Solo material PUBLICO: claves publicas y firmas. Las claves privadas
 * usadas para producirlo fueron efimeras y no existen en ningun sitio. */
#ifndef DIANA_PROV_VECTORS_H
#define DIANA_PROV_VECTORS_H

#include <stdint.h>

#define PV_DEVICE_ID "module-07"
#define PV_SYSTEM_ID "system-a"
#define PV_FINGERPRINT "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f"
#define PV_EPOCH_A "11111111-1111-4111-8111-111111111111"
#define PV_EPOCH_B "22222222-2222-4222-8222-222222222222"
#define PV_EPOCH_C "33333333-3333-4333-8333-333333333333"
#define PV_ROT_1 "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
#define PV_ROT_2 "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"

static const uint8_t PV_ROOT_KEY[65] = {0x04, 0xd6, 0xf1, 0xae, 0xff, 0xdd, 0xa2, 0xeb, 0x47, 0xf5, 0x74, 0xa9, 0x92, 0xaa, 0x00, 0x0c, 0x00, 0x3d, 0x4a, 0x1f, 0x5e, 0x51, 0x47, 0x05, 0x52, 0x76, 0xcd, 0x27, 0xc7, 0x58, 0x31, 0x39, 0xf8, 0xe7, 0x9d, 0x0c, 0xbf, 0xec, 0xa4, 0xd3, 0x91, 0x62, 0xa3, 0x43, 0x08, 0x60, 0x45, 0x6d, 0x41, 0x8e, 0xfd, 0xe9, 0x4b, 0x1a, 0x4d, 0xe2, 0xb4, 0x0d, 0xcb, 0xb0, 0x26, 0x7b, 0x18, 0x6d, 0x99};
static const uint8_t PV_STRANGER_KEY[65] = {0x04, 0xc9, 0x37, 0xe5, 0x47, 0x93, 0x8c, 0x4d, 0x48, 0x52, 0xbe, 0x85, 0x43, 0x80, 0x79, 0x2a, 0x17, 0x63, 0xb9, 0x3f, 0x12, 0x19, 0x0f, 0x0d, 0x81, 0x04, 0x5e, 0xeb, 0x40, 0x9d, 0x33, 0xa3, 0x93, 0x0e, 0xc5, 0xc0, 0x04, 0x97, 0x3e, 0x09, 0xa5, 0x42, 0x03, 0xe2, 0xd6, 0xee, 0xb9, 0x72, 0x35, 0xc9, 0xe1, 0x05, 0xf9, 0x35, 0x1a, 0x19, 0xd6, 0xa1, 0xe3, 0xea, 0x01, 0x19, 0x1d, 0x1b, 0x8f};
static const char PV_ROOT_KEY_ID[] = "root-key-2026";

typedef struct {
    const char *tag;
    uint64_t    version;
    const char *delegation_id;
    const char *root_key_id;
    const char *operational_key_id;
    const char *operational_public_key;
    const char *scope;
    uint64_t    sequence;
    const char *system_id;
    const char *root_signature;
    const char *fingerprint_hex;
} pv_delegation;

static const pv_delegation PV_DELEGS[4] = {
    {"D1", 1, "dede1111-0000-4000-8000-000000000000", "root-key-2026", "op-key-1", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEAEE69PLigAjPbDQvTeDpH8EC6g9AaiU-ZFjS1iYnXZZvUhYE3kjvTyuyVxdOWsFQylTMhfHeP9Yjeq2a8T6isg", "DIANA_PROVISIONING", 1ULL, "system-a", "tIVXq9ATt6zZ6klH8uSXdYXj1ND20EFs_wbtOz0qM4Zociaootq6Gz2Dg2j_Mk_rjpYUjZ8B_csZfFRX9EO-uQ", "58fb1aacd48b402b90a835023b74bf3ed7db1b7bfe40309f7d0804ddcf177c6d"},
    {"D2", 1, "dede2222-0000-4000-8000-000000000000", "root-key-2026", "op-key-2", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEgJIAofzIrdGC6Ifl0jLU5H1n6eqF4kzaKVAopptTtl_P8SUdYwQe1g_xTV2mI2UbWWNPbgfZ2aVB3vseZ7ROeg", "DIANA_PROVISIONING", 2ULL, "system-a", "zRMWqmUEcyFmb5WOaXofyRll-DVKl-OJLgbR0H3q8isd48ZSQqkzlQXgIP6KqSw-2y_FaerbgiAqHpPiCcrKoA", "1ada9cd455e6000de1b8649fb8f7a3b1b38eb280ba9a89dbd8e7656a763fbf0a"},
    {"D3", 1, "dede3333-0000-4000-8000-000000000000", "root-key-2026", "op-key-3", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEAEE69PLigAjPbDQvTeDpH8EC6g9AaiU-ZFjS1iYnXZZvUhYE3kjvTyuyVxdOWsFQylTMhfHeP9Yjeq2a8T6isg", "DIANA_PROVISIONING", 2ULL, "system-a", "b6_kIKmDf4uFs08qORWuxdX_BEXVhNuJEdyhMjlgw4vmuCFrurwpXKUimU1FmBnd7NCEX2iK1YrFqoq6ueEnRg", "a97bdbb6d4c6eadca34c0c18e80cace287f85024f5a4739ce5e6f37671bf4139"},
    {"D4", 1, "dede4444-0000-4000-8000-000000000000", "root-key-2026", "op-key-4", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEAEE69PLigAjPbDQvTeDpH8EC6g9AaiU-ZFjS1iYnXZZvUhYE3kjvTyuyVxdOWsFQylTMhfHeP9Yjeq2a8T6isg", "DIANA_PROVISIONING", 1ULL, "system-b", "4dnISCJmHviVvt1BGY7T2IikI7lQkMSOHVIZDGMCXbvQ6IbG3Giik5Foh7L2NPRxtkwciscehV2gsVJD6VTTIw", "9d62c5ceee2a3119d50b6df0205e397bf8c9ad8dd85860740e4982c7aff3cb37"},
};

typedef struct {
    const char *name;
    const char *action;
    const char *mode;
    const char *system_id;
    const char *device_id;
    uint64_t    sequence;
    const char *rotation_id;
    const char *current_epoch;
    const char *next_epoch;
    const char *epoch;
    uint64_t    issued_at_ms;
    const char *fingerprint;
    const char *provision_id;
    const char *signature;        /* firmada por la clave operativa 1 */
    const char *signature_op2;    /* por la operativa 2 */
    const char *signature_stranger;
    const char *canon_sha256;     /* digest de la cadena canonica */
    uint32_t    canon_len;
} pv_order;

static const pv_order PV_ORDERS[19] = {
    {"provision_ok", "PROVISION", "", "system-a", "module-07", 10ULL, "", "", "", "11111111-1111-4111-8111-111111111111", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "cccccccc-3333-4333-8333-cccccccccccc",
     "LqUammX3dUGbrOP2vUJTUDLoN-jeYC4TnU2JUAHr1DBLN2f0RCLptgITUT2xz3YqAMcuKJEp1L-p42427uRZ3w",
     "WELBP8jR2AAzvuCWjpHXoxiDuM9zDrz8naJwryocU5ponXBpHHxVjlGgvmQLPmuzjeMElD9MLl7dsfQi8mV_Fw",
     "CzvglTv4n24pWqvq2OjmArQysyjZ2sxuRplblV6IZizDbBAHTlRuxN1NQLHLBopIw1aLx-pfVYQN4oHXI1cHZA",
     "79a99508e93bdc84d31c570befdffddea785f8406c55a2bbff926f98f3fbe36b", 247},
    {"provision_ok2", "PROVISION", "", "system-a", "module-07", 40ULL, "", "", "", "33333333-3333-4333-8333-333333333333", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "dddddddd-4444-4444-8444-dddddddddddd",
     "yaPAtpPT5eqhGotiBGpS8tMFZi2RrmWEjudpNo4ZLiWPqpqE5J9QhFqnHLq38IDdfPre9bwDY2KTshQwhI-UMA",
     "yl2XZL89WbvchaztHd4FYNurGyGgBD3er8PaoE5TbYAAUy4LQaN7Git5zE9IxOKMs4q9k6KPKsucsjWPGT7XVQ",
     "f_Ahg4nBGixa0FLOKvGrXqIlNqGQyxZjD4Uo2Xmdodqi0_ZaDwJ7kLGVaN6TQSIsYOmbXIBOwa0AwCbmmxIipA",
     "ab0145d6b93c051fd56f73f3f6694c9426b23141b968289381517ddc16a71d7d", 247},
    {"provision_other_device", "PROVISION", "", "system-a", "module-99", 11ULL, "", "", "", "11111111-1111-4111-8111-111111111111", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "cccccccc-3333-4333-8333-cccccccccccc",
     "uf7YNMKUD9sNulOAUQYELCUNCgbovgUf0Ouu01MyUyM06_m061_7azsWgoBuPfH4VSf2XTVV2ppeN04vZwZUlg",
     "BlT77gS9w2nkh88juDrIRFeN8QGeVmR0y7jNLxuATODYWnNV2pNAsw4oeGp58C5B0Nji2iVvL-IXYI09S1F-DA",
     "2b4tUNy3zitDnO5pTf0Hp-Bbbnz_WqbBHRNnYhsw9eCCtTY_tnOh-1n7AmcPu1q2WiUad6ii1yJoMEcD0nLEIw",
     "790349d70967977d9c6ffba7b73ec65223d2c7ce552d87d16180056c319b18e4", 247},
    {"provision_bad_fp", "PROVISION", "", "system-a", "module-07", 12ULL, "", "", "", "11111111-1111-4111-8111-111111111111", 1750000000000ULL,
     "2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e", "cccccccc-3333-4333-8333-cccccccccccc",
     "o80w036vuzCiRvwvGKc0C8QgH-xArP6TEdT38NrbcVwY2E3X--Fv5slHcCPV0NGxu08BYrGqGgiXgCPXB-Za_g",
     "8UCHsxtFwzxlbUWJJV-_YSIn-Z63-BeJTsxItGdvGaQyhIxM9KXm-1bxyxEGpna7nagUSk6-okogiq2ROtWSEg",
     "gs_NfIyy5WRk0h6uO_txpTw04dsTy6HNJMptj-p4ossR9klGMCIRxyp6L_gEVCsOjeTwyYs8VGlNesVsJn8f9Q",
     "db98a34f76a34dbadad18a18ef1cae7c0c561e323e93d5164863bd7370b50b49", 247},
    {"prepare_ok", "PREPARE", "NORMAL", "system-a", "module-07", 20ULL, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "RW2Kcw2YaBCmsoKTfhQMUWxmXH1lVmrHS-ujrwvgyzBr41xEglhBmmqiOL8Wbrw0R-2umkkzM-SoNvGT_Y7Btw",
     "yC8zbYx22gy_cKxPVRAKXI3dhWXzd64Dnv0IfqL9Hqx0rKvZ1xE8e3QvDKnpOZ6iAsED2xImirw4qPPOM-BXSg",
     "R9Z7_tnJdRqDaqKwgb9XSI-psvzPI3vrDYHt3LddrL_J1M8DfsIe84IJ6qmASZ67M6jWmbXQCA1TbXbu-_n2Hg",
     "56466f09377e9355549e8b6cddec15935c9a5e21387726d5dec7b5b8c02c6434", 287},
    {"prepare_stale", "PREPARE", "NORMAL", "system-a", "module-07", 21ULL, "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "33333333-3333-4333-8333-333333333333", "22222222-2222-4222-8222-222222222222", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "Dv2KjfPHiER9hJzVGA3fKG7K3_3uuBtneweyfkw13hplimF2rwabCinWlPFQqt4wFfla4d1m-BbuXhaVAbybTg",
     "Fl-oHha4feJSWunKd8uhCjEyweKOs1Sorbz9odc1zJCcSoEVbkwWmsFa_w87jtXyuoQKKIcRBDFqWZrM_FlV2Q",
     "alUXE0QvTM_e_pm0gAecbBma4oq22GVhGkzQwy55L4Q2lg9xhQ5cEhcBhSceUTxmxaQL6T9K0bF26V5PHBG9JA",
     "b3d264977e8e051082835849582ba06d15fd2290fcac5eb18eb8278dc6580959", 287},
    {"commit_ok", "COMMIT", "NORMAL", "system-a", "module-07", 30ULL, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "7b_K5G0U-Lvvtx6ivmkYohZT5Na3d1-qJSU_NsTiWpqEjMGsz5WV-zuEZxcLRv4ObWYolxU-jbu7HwzD1mjemQ",
     "8_bzV9YM6CLXKn70uCHPg6cvyFOrRA0nZ0zAPZEfE5KLZGEs8gjxI-keQ309pIe4NWgZTxSOKFlZ-L-r5xb5ng",
     "RwEB3SBkzUk5wYwoyWtw8rLQdD3D4HD3bz00CTbHuXVEF8frs9rJpBtth48BaNujoiLhE0HoeXMnSEJ5EV4NZA",
     "71eb951f9a0034e6f02e23cc44346215145854e2a5d58a372e71de84e8c2dcd1", 214},
    {"commit_unknown", "COMMIT", "EMERGENCY", "system-a", "module-07", 31ULL, "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "gbDUwHrycWeUVWYfi8k7yXFfkoxT1z-Ot-K_LNi40xoEcF2rirnxfe9FgGsaKJpEpxpEecgcf3G4LbCEo9fnwg",
     "Jd7wLv_AEnsy7xXwOou6BdtKaNtSNqNYAKzvFmUitn6Ds0_0YHVjdUkwUE62tYVPck1n956OTfRKtj5ug9QZyw",
     "RRAUC3byStiZvfy0CV1zGcWnD00ss26fVbqGxeW3aVNstnxPP6mRPY3Uvu_NiGhtI65-Tmrkp9mL9OQ_nKoN9Q",
     "03158b1cefd40b235d520b4b7a770cf620d64fcf76063cb0c15b595885c6e711", 217},
    {"canon_minimo", "PROVISION", "", "system-a", "module-07", 1ULL, "", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "uomtKL64SacK2n9SUOItgpjrFJ9uhCeUgEUaazY4mTxDa4KGlgLpS7djwx7xSyqz-3BG-0JyfkCxhsSuFdaKAg",
     "WtyV3C5XOPBToYNjeXikZoaDtCs_LMb8YlvXkO3UviWqOZSDJQjTmZkbsZACpR5wDriUEfPlRNsCK6pmHNvTSw",
     "EhDm3KDQexl5VDcpD3MFBxAcBk-hvYRuV6dNfjwbETgkbKFdPGKaXR8nn8VIS4IDnC0lgbiz3QTm4_8lH22soQ",
     "ca7ff859e83d60ac343d56b379336e553b8d45cade8c6e30c97d6d2fdda7bc2c", 174},
    {"canon_seq_cero", "PROVISION", "", "system-a", "module-07", 0ULL, "", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "l0p6YjAWv6iYH_bPiLx04fl1xouH3sIq5CSt-5P3rGR0MS4QgxHUO8kiLOdAry1qaQQV5F9PtEpFxzDM7JSQkQ",
     "jpwchHbRKpn0monfgsUfSbnjIeChsLYGD4UpI6me0I2t2x624VM697pf6kceyiDO-WIfA9lXwOWT-ROczbzDGg",
     "xatEfwINjZ_ZVLCj23bswdRLYVlkvtjJRw4fvIIDU1iFxxqlLNtwSsMkYtE_Ql2n0V-Jjhe09CwY0NVIcMXbng",
     "7faf3455071b040d50d0e0b23f60741e2dd22989a401a5ac63f479068316ba1a", 174},
    {"canon_seq_max", "PROVISION", "", "system-a", "module-07", 18446744073709551615ULL, "", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "co8u2EI-HcUgQHm2stQ1nXp_WIGCHRTZdZuk2DFo_R3NzYGumNf01-uH0CJ5WX23tKVpYRM-bqW6bj7cOc7lUg",
     "6F2gsDICKFvgolD8l45N8K4hs3dVj5LZpbJkdrUMZzva-haio7GGQPI1YOfmcWs7CssfWhlsoARhVbvNRPxs6g",
     "XHL_t-mVMB2Qs1fDVHczTSkyyQTDu_Rk0tTm2KAjNpq9OHYD8PHv4loBCk05i2cxsiMr7qJxbzhU6ZZNWZwuhQ",
     "aca2e82e37d19cbed5e2448962204f9b2d6c77eaf004bc43a1c959e1b2df21f5", 193},
    {"canon_ts_cero", "PROVISION", "", "system-a", "module-07", 2ULL, "", "", "", "", 0ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "t2Y2dLjWDBV2_WnJzsRJdNVixp01Mm5uRHXvg83mCkbu3uMqPmajtPwz2JEwqznjJB9PST96LhRc90Cuta3SpA",
     "4lEIWreH-WpznU_LKxOB7x_iQkRq0JnvL6AkCEfBawUPJiQ8lo3cIsOTVWRH3L0WWTrVe0_cxdTedKmmP2BAyA",
     "xATfBy4ZO-_a2dE3y2KbickKpnD193qtIG4f00q0xSvGisiFeGbphQpEFrBJA18JNM4rRUuNzPjD675lHLVP3g",
     "d56f137a2e7862531b7381c4c03fc9e86b6d14f110700a456bc8e48f52fe7875", 162},
    {"canon_ts_max", "PROVISION", "", "system-a", "module-07", 3ULL, "", "", "", "", 18446744073709551615ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "-xWYyibusNKO_fWCWXa9YmbvwxyD7C93SVighErvldIPRt6pSh6Gfajb3R987hUi-acVLAEIZszWYBVZKE9uKw",
     "UnX-OzJPVp1u1KHcE478kK0Jhz7ETXgJ4E11O8Fr4vm_6eS7Sgc3Us38Iao7NWofC_GVILDGWZ_Tztwewe0fSw",
     "YJEX_HrtHQ6AcQgJlD-S1BhmwTkHZK8_kYvFJZHFcynswwiJR9tjONu0ScN1SVQiVayCTNssRxJJY0Jrkif_rg",
     "e9cb8cbbee1a08c69f459111780e52725c8b3b79a814b968f559d9371f7d7f3c", 181},
    {"canon_todos_opcionales", "COMMIT", "EMERGENCY", "system-a", "module-07", 4ULL, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "55555555-5555-4555-8555-555555555555",
     "FvH2yb1jECGYRLYo4gaEHt4CaW-F2qDwX4pQa67rUAAUgWo9uz24c6QRAfp6wZfAZLL4h5SiQAD7CSqe2llF_Q",
     "CQiHHvFB7kjLxTJtmuBDzK7TI_4ZtWFlpa8rsmntBxNqu61n2IsGy0o66bPTGvUuNvnB2m8T5fMXUhArxI06mg",
     "BHNKNfHK4sXQJLlvhIcHVtQ56JTELXZ0fZ5nfvLWCFmbea3goooHn6Eec_kS69PTjn-_FSRKge-RFzDbq9H8Xg",
     "bdc0e2cea46c87a4458362874753ff13a2649e56b48f6538b5c56ba1116140ac", 360},
    {"canon_vacio_explicito", "PROVISION", "", "system-a", "module-07", 5ULL, "", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "nDBSeLCNc-fcFkuPTCaVD69fjq512oPVydugL7lpFxulxCDhwO3FUEVuBSRH6bk0Ts30dcBKBEm55KPVL3SWLg",
     "gRoJ_aN6799mrKFKgpfAvA9sGgfP9B5MhwypSpe7GOnFYvfEn4k36SH6SgAYbDsmKcycA_H_ha0J7qjQHIqReg",
     "OQOgf_s_a3TqKL95HTm4CKQWmDIaPM9ET9mdebzLYsHkfTcgwtnQIl6ZlHZ2pr14QdLSnJFqn8NYC82l7W3B6Q",
     "a82ad2c77551db2f04dabbcaee7c003d228b66cdc7f8c417adebeea4b20fcd53", 174},
    {"canon_vacio_ausente", "PROVISION", "", "system-a", "module-07", 5ULL, "", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "79Tj0lOxf40xSCyX5uJe5rS-7iMFlXWinxE3p6797EWvmoutVxopHMMQxha9OiLpG-DraBbTG235is8W2zcL9Q",
     "iYS_0UgRp4S57Y8qwWU0XP3luOZKPDSa6ZxKGXNHHzJkIC3kdzFSjYwQ5BXURpMXzPUkT_N6zyCMGT38kgUMbg",
     "TwM4MwRQFeeqJofAldJ_gQ3rekV5mPMvlMNH8eStxfBxH4onrH82RUHwrbmBHr24C1S6iDv_ABp2zHGTRuC3VQ",
     "a82ad2c77551db2f04dabbcaee7c003d228b66cdc7f8c417adebeea4b20fcd53", 174},
    {"canon_utf8", "PROVISION", "", "system-a", "module-07", 6ULL, "rotacion-ñ-€-中", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "RbIeNSRkUX0xRdHGupKQpgEW-RXlr1uH4gY6OABDLI25ZOGrrTWGBPY83W5jvbr8cmVSgGCHhBdmzOVJw2Kprg",
     "HqtM43LxXQ8n4qdCBePBqGEcBngo2dbmTPhWUhB31V_UC026aK0DWSoPEPGogf-MrVE4iXJLxdUTqa3unQdQSg",
     "y_jSkfqMDTT5GtcGVk8XxVWe_cm50TwFTtoycxtTmGCkPCeNZF1d1G-vNgVfVNof_cerpkhbxIOhL0dAUUzI4A",
     "e583da0b854f423bf1e060fe1a8e0b073005afa9176042d4eeb5d7fa9a60d9bb", 193},
    {"canon_un_byte_a", "PROVISION", "", "system-a", "module-07", 7ULL, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "H8XSmbbRV_iqIdE6C8C4mz3yylVxaZ5CwUMCfBnydPEXNI8YoM56bPpbRPGP1ZPRWAi-cImNcS6kVQz8jdTcqQ",
     "DIO2-oSMxD2q2LQMzd0H100mq0TF3GSRV_axxybHjklcK5mfPVyZ_aW1TdrHp7x1jPndDamLVVuAuO0uvpkLiw",
     "vFJk6XuEEdNgV5VD4VYkdKfBvstnRh7QPzJTBxsvUyK04QEuIw6lzC8GbsycDbCE1Cn6OokViICBi2fVklPmFA",
     "817444e946861a9e51e8649d3996b8224107532d1e176d5a760952f28692b00a", 210},
    {"canon_un_byte_b", "PROVISION", "", "system-a", "module-07", 7ULL, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "Qv_6MYfZqHNf0pplnz6__dGcde6UbW1rGG2U0oIq-10foErUZ4KruCW3aVn8pNx79pOFwnFGtSI6MgAROTEpvg",
     "Z7X4I8U6Sn0Mfn6o2W0RDuX1HdvQWLUfQWGO-j0KVO0OruysZ-LWbzVtDb1f8kl6E3TPLa2Fs_NF7EZonO5nnw",
     "TbOJouJEWS9lRavjJXGBilfKFBlXaC4zTYnOPBtOR3iJZjnEvvOUtrT_qBQsU2DSXJyNO-PATr6l_HNaZD1Jng",
     "2f2f90bc837c9adc1774b82f148a957eaac4571cc4fe053450cfaea4b6d8f598", 210},
};

#endif /* DIANA_PROV_VECTORS_H */
