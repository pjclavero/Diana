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

static const uint8_t PV_ROOT_KEY[65] = {0x04, 0x48, 0xfe, 0x15, 0x7d, 0xf2, 0xf2, 0x1e, 0xab, 0x8b, 0x53, 0xe3, 0xdb, 0x68, 0xd3, 0x61, 0x26, 0x50, 0x1d, 0x7a, 0x6a, 0x4d, 0x51, 0x5a, 0xf3, 0x02, 0x37, 0x49, 0x23, 0x7d, 0xc0, 0xb1, 0x40, 0xea, 0xdf, 0x94, 0xa6, 0x4b, 0x00, 0x8b, 0x02, 0x20, 0x72, 0xbb, 0xd5, 0x96, 0xb6, 0x8c, 0x25, 0x10, 0x33, 0x3b, 0xfa, 0x19, 0x92, 0x20, 0x12, 0xc7, 0x57, 0xc9, 0x0a, 0x37, 0x62, 0x1b, 0x18};
static const uint8_t PV_STRANGER_KEY[65] = {0x04, 0x39, 0x1c, 0x69, 0xdc, 0xe7, 0x3d, 0xe9, 0x7d, 0x7c, 0xaa, 0xf2, 0x78, 0xcf, 0x34, 0x32, 0x80, 0x4a, 0xbc, 0xca, 0x76, 0xbb, 0xb2, 0x99, 0xb8, 0xbe, 0x79, 0xd1, 0x52, 0xc3, 0xca, 0x8a, 0x21, 0xdc, 0xc1, 0x55, 0x3f, 0x7e, 0x2e, 0xd7, 0x18, 0xd2, 0x37, 0xe9, 0x41, 0x23, 0x87, 0x28, 0x9c, 0xc9, 0x7b, 0xb4, 0x2b, 0xe5, 0xa9, 0x5a, 0x5b, 0x67, 0x13, 0x9f, 0x0a, 0x5e, 0x77, 0x67, 0x11};
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
    {"D1", 1, "dede1111-0000-4000-8000-000000000000", "root-key-2026", "op-key-1", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEaQXG4uLbs2D8cWuW1l3-tzUFIDcujK_EcL-Rcc762bpvxi3sac4Liw2EDUPDkpfiKqwgjVqZYX3z5qcCZVg3yw", "DIANA_PROVISIONING", 1ULL, "system-a", "jM4KMMGWBfcGPUfu-p6DCribYE8u3UtRyhXNT3hFVGSEgKJMOoeooUHbxDQyOiVe2oyYdDf33lh1xnkVjmRrYw", "5fe9becb3c9d84f32568120adbf5068b7399f9127591bfb6e17d87c36251f50c"},
    {"D2", 1, "dede2222-0000-4000-8000-000000000000", "root-key-2026", "op-key-2", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE_uqrEFIbduzDvwYzdoTGomvjfTnwT6wa3VYIdtFcQI8j1I-2v7KiQ3WVV9V28D1qyHmm0bClLzud1LP9OzJX8A", "DIANA_PROVISIONING", 2ULL, "system-a", "OUQ8Pnb70HLxmzcY7UcwUR14PV_UsQNvCmWSZAh3ddv_nq_arrnop4TtDKZGb9gDjwbIF70NziJo7NxL4AujxQ", "6402fe8da7d9043981954596edea28df433b677face14d031586140a2f8878fd"},
    {"D3", 1, "dede3333-0000-4000-8000-000000000000", "root-key-2026", "op-key-3", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEaQXG4uLbs2D8cWuW1l3-tzUFIDcujK_EcL-Rcc762bpvxi3sac4Liw2EDUPDkpfiKqwgjVqZYX3z5qcCZVg3yw", "DIANA_PROVISIONING", 2ULL, "system-a", "h8aIJWk9fBVVINSw1eIDKBpP7ONq4M6NEK1BL-Pf2dWLXdGFQq91z9DYbkLM0TuFZgjtjnpAp_Y71VvA121MPQ", "92d2e0a3132d1b6928e527ce391a1fc379fdf48483728ca92e72775ad0e03dfc"},
    {"D4", 1, "dede4444-0000-4000-8000-000000000000", "root-key-2026", "op-key-4", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEaQXG4uLbs2D8cWuW1l3-tzUFIDcujK_EcL-Rcc762bpvxi3sac4Liw2EDUPDkpfiKqwgjVqZYX3z5qcCZVg3yw", "DIANA_PROVISIONING", 1ULL, "system-b", "ZWgs9I5tmhketmAqPVpXEcNMVeh_5c4-7D98qmS-TIPZ_UyGnTiqZn0U2ulbV-LBWMC2ynakphUPzdW1cYdOkg", "84ba6a3cc5e6603ba3f19e6481f39eeef95c5841934492858cea6da2043eb71b"},
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

static const pv_order PV_ORDERS[21] = {
    {"provision_ok", "PROVISION", "", "system-a", "module-07", 10ULL, "", "", "", "11111111-1111-4111-8111-111111111111", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "cccccccc-3333-4333-8333-cccccccccccc",
     "dnTC7KUu0c3xNFQEgXresmZ8G3sXeD0k_GrxpRYU58qg5f89c_FwhZ4iOomaL9ZNquHcR6aN-W7g8HgSN8-b0w",
     "ciEGK6OdFhbhCMj8tjw-x1AQqSNImg7PR3ImBnmOpqmAuWIc5XSm5RIXdZeBQ07TlPi7ofwBJ0lzc2KPjGDGQA",
     "kkcT13bla7YgGTqsdTOqX9pQUL5ZYfS7lwuEKuaVSpUk3e7KRuGHEZ8LAJBb4Eq8S0qEf9lV9aRFtkKIQsrckw",
     "79a99508e93bdc84d31c570befdffddea785f8406c55a2bbff926f98f3fbe36b", 247},
    {"provision_ok2", "PROVISION", "", "system-a", "module-07", 40ULL, "", "", "", "33333333-3333-4333-8333-333333333333", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "dddddddd-4444-4444-8444-dddddddddddd",
     "u8MwPFDHZIbKBgc5mKHG0PuzeoOeXeuwg2nhUfsLmWMnHt8-EDyY0XP1CHl3JVh3mpnfoKz8SBio22MF2YKpLA",
     "WuhQ15ILtOUKJh0ipmwJqxJGwsbn_uFDoyuoOX2nA-hBz15TfqFwA2uUrYPu1fxpnCPjofdnUyepMRx5g_43tA",
     "TzL04C_qGqTtNbrBkzN0bHTVuADL2jIp6g9c9VQpQLiTzX2-nnXyxFJuRgdUSEnrLvaX-tjvcOalMjYt09gddw",
     "ab0145d6b93c051fd56f73f3f6694c9426b23141b968289381517ddc16a71d7d", 247},
    {"provision_other_device", "PROVISION", "", "system-a", "module-99", 11ULL, "", "", "", "11111111-1111-4111-8111-111111111111", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "cccccccc-3333-4333-8333-cccccccccccc",
     "SD1MRMRLh3UY4v1w_FWsSDAZ7G6jpZ_VLVerKXYhDnlL68SIoUGMomHHnfEO7Gx6MFsjKVvTERWRpUD_dGB3Eg",
     "CWF0piRMbktNrD8nRRnujkvJ2UOKFlfHWiBG9f40Rhnb0IpOffYMEz5guBXgoCcaGoOxYypjIWrnKGbZ_p_jkQ",
     "avVtVYk-psGDUDr2oXdKKCNN7pNPw2wIXcrNod09vTC0Jh8gJ39tdgFL5ghyutP_yzYZOVSM-ZqRYbe9FQ1JOQ",
     "790349d70967977d9c6ffba7b73ec65223d2c7ce552d87d16180056c319b18e4", 247},
    {"provision_bad_fp", "PROVISION", "", "system-a", "module-07", 12ULL, "", "", "", "11111111-1111-4111-8111-111111111111", 1750000000000ULL,
     "2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e", "cccccccc-3333-4333-8333-cccccccccccc",
     "hGFBRHebUN_SvO2GzWg3ZZ3bfe-_E5HzQao0DDhgMOy5_1M29SYsIuB36Hl9Rquems-MfEkXDJtwjuYBuw38Ow",
     "iuxeiowszZYsXk7Htgoa3lTrQsPO3WirB4tKn6v_wP3IN37OQEXL7C8y1mRbZ34vaI6hHu7H12K69TBwq32kqA",
     "945Do55QxZVuD3brv4dfElFUVGeLgsQh_OsAkcq6XcKX6oAbnZQ2pa5MHvECYg5J4Wtk6Cmlt9hI_Z4sSkzPuw",
     "db98a34f76a34dbadad18a18ef1cae7c0c561e323e93d5164863bd7370b50b49", 247},
    {"prepare_ok", "PREPARE", "NORMAL", "system-a", "module-07", 20ULL, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "3U110rPiU88WjHy1RjtgFg8NZvtzzaS8aMPZ3UQuIhxDWQmrN77qIQro6medlQ1qks-HEgPvEt-fk32L4otn0g",
     "pTnQoLesdNqG-Y_fVsjZGUNpwiUcrFnRcIyQroK1NcPtfxg_DSVmslksAqu4h60HQck8XZhZWhixstr4gU6d1g",
     "v4oGZ7QHRuyRxD4M9yw9nulNEqjFazNF4dwbjZn_VG6dBibuj3_npvKZIZdKddYK4i7MwFXaoYcxmKSL3xp3fQ",
     "56466f09377e9355549e8b6cddec15935c9a5e21387726d5dec7b5b8c02c6434", 287},
    {"prepare_stale", "PREPARE", "NORMAL", "system-a", "module-07", 21ULL, "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "33333333-3333-4333-8333-333333333333", "22222222-2222-4222-8222-222222222222", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "SviB3TXpzkGNWHBasmdzAPC8fMnmRL1x6uu_AFN270xf5onUSBC65Lkpw9FvwjXq8MTKKE3sKxLZahLA1_o8ZQ",
     "HOlz7_WKXnVURJtsvErBMZxmeKWVMXwuo0noekvU8wN7M_qQFjj1tpZLxMdmHXWgllZSoG2buDdYHZRQdduVpg",
     "cRgPfcd5eo7Se0A02C6-y5B4MCeMz-Ek7XrJGD64rIy20Lp56ALH-65ZK6y7si5iDU362lYVCVH1SOU370xKSA",
     "b3d264977e8e051082835849582ba06d15fd2290fcac5eb18eb8278dc6580959", 287},
    {"commit_ok", "COMMIT", "NORMAL", "system-a", "module-07", 30ULL, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "VC0X_aNK4wgK-OBkeGogrtJPzpxUzelLUKYirBqG6Uejh3m8IWXlc7UWa89XL75Rya1vulFJDmjw7soqSw9L5g",
     "MQl_RiOMaoPOFkGuwN0R29LSw9chfCRNxMsfdleBrIaSDl0iy0RC0Ggucz23hm3a7iFbN2gxcrkEtvJ1VwizWA",
     "rb_7tolJGeizzPCIipvyd9pb1VMKt5GucwT59Hfa_UoWFkx0O6HaZ0rZGwlR5schs-IUR4MtqO3ns9wt1fi-Cg",
     "71eb951f9a0034e6f02e23cc44346215145854e2a5d58a372e71de84e8c2dcd1", 214},
    {"commit_unknown", "COMMIT", "EMERGENCY", "system-a", "module-07", 31ULL, "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "GY2BNb9d4eLY1XAsl0pfcS9T5uAWLQX3DgGS87wP06yzTyA06B5PpjR_v6DhSjoSlVMq0In-XcWNiDGyVoo_qg",
     "-c0UAIkOrnFvQkHIdhpcogqZN-c88UbIttSOCynKZMVgj_k-6EhczNjUELN_uN271uPq6DLxXdcc2tIk6jtgdA",
     "X8RrS35IPq9p196g4zBCA_IaloAwTMkKszfnSmANuG2okmjbKAHDinpXYBKXf5gVdQWGjrT8MO4iQVrYsLDUwA",
     "03158b1cefd40b235d520b4b7a770cf620d64fcf76063cb0c15b595885c6e711", 217},
    {"prepare_seq_vieja", "PREPARE", "NORMAL", "system-a", "module-07", 5ULL, "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "b-HXcAjsQT1IcCQPPPzPZiq1dR028C2k-1iYzIv2qsjY60arSCkNaCuXXK32WALvxylbbjOLoVKze7-2gKwktg",
     "nTwR_CNhI_mf-W3Qyrvk8ezCVZGA1vHnmNk6HA7LEjzPniHLBsS7gsHtDMsrYIEY5geoeden6vhjsvZa0mypTw",
     "73anLeY8jzcmnPiP4KRMI60wi2ztkQaYs4DU0QdzjHoKo6cNuZ60mVsOf-Umht8pD0zIsPZuEpU1l_fMPDVr6A",
     "0bf26883b8d0bedccc82da924d3fc56254af967a1af149990db02ebe21d93e64", 286},
    {"provision_other_system", "PROVISION", "", "system-z", "module-07", 13ULL, "", "", "", "33333333-3333-4333-8333-333333333333", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "cccccccc-3333-4333-8333-cccccccccccc",
     "D6L45GZceSajopHmE9fnnYxnOo181j4RvitzCAenSJ9-F32TjleFIZPp6znMr9Kl0yWZ5IUVQPIT6B6N2s9T_Q",
     "KXVXZ5iuyt87dJJRdV5kFLWT7yf28YHoBIRNAelDIfRPQQAphTwlueOkMK7SCPTakwN0GyQFywZD_uHg0HhCTA",
     "7bfbQHynLqxBL_xz-rkVetQAlhGgdW8UMVTMtaEUE9A_Hfi8nd7PpDwRTsIut31Sa5oKw3EPGaafNNYxaf5Eug",
     "fc713a7cf3ae8a32e9d0bc5c75ac0f7e702922d7b1acf36898879f044f78fd9b", 247},
    {"canon_minimo", "PROVISION", "", "system-a", "module-07", 1ULL, "", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "J4b8lUrDXPFazDDiY71LKKLldNa4Y69kxYODixRZV9nIu9Jxsclxxw5iWUppkNDnjhAR7b0ba5PsScz0eRf9jg",
     "RUyR63vnYX0c2zS9RWipPWUn_NzEUYZ9CzgvuKpglhNOmLQZpZcvmZR3tSVQApXE3w5hfMW9e0sWpEZqsR7dhg",
     "hHIAN3CClja6xMGp9N9V0sE3FFiEZavSJtOf-dFN2Kj27v5t2Zf-5Frm11YXf8WUdpLD9KiL4hQNWqlE5bWrDA",
     "ca7ff859e83d60ac343d56b379336e553b8d45cade8c6e30c97d6d2fdda7bc2c", 174},
    {"canon_seq_cero", "PROVISION", "", "system-a", "module-07", 0ULL, "", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "K5eDwzxb8hkdVoj8Ap2NvXQrtoy68yPm_8ouahbaYT2DRRoc0FDlZROUTcKCSnP1uL1qBqhaVipkE6E1nz2ULg",
     "MA0mlfKd-mUg-vwk__wOE1A017yqaVEH1bGrdXypCy53OfNyevXwZLiFLnVduxCbw3Au8mU3-LJs-AUixm4T0Q",
     "FkTVCs4wKPEUCRSkUWBWCYONmQ7x3O-pfrvEQvePQQmQAQXeSzcmAV8hht6N_656OBM0U7AHWa8qwNC5XDiqKA",
     "7faf3455071b040d50d0e0b23f60741e2dd22989a401a5ac63f479068316ba1a", 174},
    {"canon_seq_max", "PROVISION", "", "system-a", "module-07", 18446744073709551615ULL, "", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "a5txCT5hySLJkNZL1c-06QLphWc9LGNXRnKgfLHWJ5Tn_3wSm-hXg8huG32jEz-mpKfPfjOY7x29Y9K3t_DvdA",
     "dGANdu4sjB8SqaTRFjO8GIKYZj3FSoNQaaudIkr1LtFDHxGA7zTK0QSC8vzTrpac2xON7Nfa2Ofc_nQnXOXiTw",
     "MpetSels8UbK6WN2o1dMTmA38vvqHn_ad4rPeV2FUweRWmSC7psQqAnGGdu4SKHuevkbkDHa3Rmd-2LPdR6wlQ",
     "aca2e82e37d19cbed5e2448962204f9b2d6c77eaf004bc43a1c959e1b2df21f5", 193},
    {"canon_ts_cero", "PROVISION", "", "system-a", "module-07", 2ULL, "", "", "", "", 0ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "sv-IZF6utjS1Z998jXczdQaBRHRVTZvKf8CuBU6zfR2ZvHDAmEA6WZ-PMcIXoZiKUZgMKocE6rPCI0xWg0_SFQ",
     "38OotZFtC-oWGxomn5HabLz3VG_cYWwmvOnn9YKi9Ut0gT1WomMMtfOteYAHYKu5sd0vz1sMYICpWB79hB4RRg",
     "w2MGERbU2GRdmQnzxuYPzdH1J47oRnBbRgDa0PJZngDWHOq2ZhfpaXVO4XwKT5GsrtzYJwZTudrSykzoytDM7w",
     "d56f137a2e7862531b7381c4c03fc9e86b6d14f110700a456bc8e48f52fe7875", 162},
    {"canon_ts_max", "PROVISION", "", "system-a", "module-07", 3ULL, "", "", "", "", 18446744073709551615ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "PqisrWpbDtM8lyubt1PEiPDq9iJDqwGKMMzRSefHQ3uT3IGicOIzlAU9zpudYKfGh4Y6-bhqO-BkCDOzkFsKRw",
     "d1TJAYCrPoKJXIDS5sjHmO8dJGwTxQcqn8Zqyel4zZTZ5ScA5GhDo1QyNLY4It9nFFjqnP-cA-gpNcrqpbLgxw",
     "fqnErQqHskMwIOxpviDO7P7hzaz5kJVNPKPjW_UeXsC0PHMPOb0aD59mLOtcO5D4vicclBmKsh3E4PNpaJBQ4g",
     "e9cb8cbbee1a08c69f459111780e52725c8b3b79a814b968f559d9371f7d7f3c", 181},
    {"canon_todos_opcionales", "COMMIT", "EMERGENCY", "system-a", "module-07", 4ULL, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "55555555-5555-4555-8555-555555555555",
     "o0uv7ZRx_YkMVedNJLXGfTJW8dcFvm5sqRyHZWASbmHSTi5MuDrqzeydfdxK9R4Aa37nBNo17WVIroTSin8sew",
     "twIBwkmWd2O4Xfip-vQJrbOzDKMAfsYQBx4L7dm8k-Xr90EtkcMCzKdURa0xg3psqFZtERapdeK29dIRBlfKVA",
     "yTOzNtewWra4ueaJUvDWfbLCM55UvwchyDDwaZ7u-ER6RPb_MhfrMWy_R-mlhwqtcTbF6xmhP0Q9Tc9luiMZZA",
     "bdc0e2cea46c87a4458362874753ff13a2649e56b48f6538b5c56ba1116140ac", 360},
    {"canon_vacio_explicito", "PROVISION", "", "system-a", "module-07", 5ULL, "", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "Exw57HwaZNKk-WajoWlJz3rJue67wXR-bdCdoNQ-uu1-BFjBGU-PqDdLeMruidANCYk_G1j8fa1Pawc__dyzBA",
     "HyEyhpNbsSdvIMZKuro56S6SQ0p-0hb0ZhmNn2XiFHaqiFroHNzz1uKmfW9u4-Raw3AV-xJGD1Qo6e_vv0QjfQ",
     "vVQbIOLBNX2ufLRdsVVr8gpYqjvZ83b6W78Q5Hd1tq4G4kE27pFvCtHHZNtrHj0LWysluRpEpdTmpQQbMNjfVA",
     "a82ad2c77551db2f04dabbcaee7c003d228b66cdc7f8c417adebeea4b20fcd53", 174},
    {"canon_vacio_ausente", "PROVISION", "", "system-a", "module-07", 5ULL, "", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "xbZvzaOTN9DqSyPqnZpVWxpc3nfOXaL5RMlWqkxr7-MtaCZ-N1zyFD8XPs_I3-_EpKl8jaOAF0y1tHjyrRk20Q",
     "J7-Wt_zZ6GTAq6tnQUkIPTdXcSfNIBJ61eR_cFcak9SpkqMbuNdCIDUPJfW6mGh4LHNAZU6y_LmmRkFFexq_LA",
     "8V6MgSa8i22F5kdGbrcoJi6XcmOFl6Mx0qe-0P4c5J0V1i4ZIWDNjjMEbipCDvv0wPFOHjh2HXpGleRUGmOt6Q",
     "a82ad2c77551db2f04dabbcaee7c003d228b66cdc7f8c417adebeea4b20fcd53", 174},
    {"canon_utf8", "PROVISION", "", "system-a", "module-07", 6ULL, "rotacion-ñ-€-中", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "IxNxsmO6PnW_7optTQV_xUJU8sgvxsOih3mO2lW0BlIMC5pEl7AT4_28RdCBV32TFA0U_G8tZ-RNPO6JyMHqdQ",
     "zPw33E8-C_04MSnjzQyVrAk-pLfViKZnbaMbY88wYiyF3-nKhSEDmP45YgU3uUKm9Wf_i8o733s8I3X2Y_JLpA",
     "qHnpSPs6FoERJDIStGib4t2kNu03zQ2CBXtMwwTjhPhZzdMtQerlXASJlXHg_x2byP750yxouj0V0HN4c5EP9A",
     "e583da0b854f423bf1e060fe1a8e0b073005afa9176042d4eeb5d7fa9a60d9bb", 193},
    {"canon_un_byte_a", "PROVISION", "", "system-a", "module-07", 7ULL, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "gQDdu-db3mP4EYGHzNO_BEdKhfVmESXuUNZ1WO5sCpH-i6kdKBDXYi3Bl-9iupPkvLZj8479yTaHA6Qsgnkffw",
     "htxBN5v0RlK_3yUl_dd70HhLABBh3xV6tjHWt4650zg91Y7qqvT6D9SkQ0Rzmu0Zw4MRtgz-tcWlF0rKfkuTng",
     "UulQdSekFdxpMTuyOeq6sGFmqA9HkzHFae5aK4ZTHh9XsKCpKXEJbF22e2dtMhOc7t1IZf5zC60Z906YT7HzMw",
     "817444e946861a9e51e8649d3996b8224107532d1e176d5a760952f28692b00a", 210},
    {"canon_un_byte_b", "PROVISION", "", "system-a", "module-07", 7ULL, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", "", "", "", 1750000000000ULL,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "iyyZEb4GhuRSN-fWbB_qzuJfvuschCG4bEP_5MTqpKHk99KESGxRM9ry8xRFLKhOu2BbVLR0DdGlv5zSLhefWA",
     "Q_k0qV55AJatIEdhjm-grBP7lJZnOaH62DzmJjz2eGVUcqrPQ3RgX-WvTHzSa-KgDGRc2QIGWU1cIqItfDvaRw",
     "gB0CvrYEJGlCSRUcRnnxh9jMF7w0LrkPgju8YO9Wp24EIC2Ewa84A1NVWS40mVACoggp9xla3_-gymkJqwL2FA",
     "2f2f90bc837c9adc1774b82f148a957eaac4571cc4fe053450cfaea4b6d8f598", 210},
};

#endif /* DIANA_PROV_VECTORS_H */
