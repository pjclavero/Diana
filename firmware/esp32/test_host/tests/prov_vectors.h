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

static const uint8_t PV_ROOT_KEY[65] = {0x04, 0x67, 0x7e, 0x97, 0x93, 0xa0, 0x0e, 0x1e, 0x72, 0x62, 0x0b, 0xf9, 0x1d, 0x56, 0xad, 0x81, 0x66, 0x9c, 0x85, 0x18, 0xcf, 0x92, 0x17, 0x79, 0x41, 0xcb, 0xfa, 0x8d, 0x17, 0x0d, 0x05, 0xc6, 0x50, 0xde, 0x73, 0xeb, 0xaa, 0xf2, 0xf1, 0x65, 0x27, 0x3f, 0x9d, 0x70, 0x37, 0x59, 0x42, 0x1f, 0xae, 0x93, 0xe4, 0xa5, 0x3f, 0x63, 0xbc, 0x2b, 0x16, 0x57, 0x29, 0x8a, 0xc4, 0xc4, 0x0c, 0x6e, 0xaf};
static const uint8_t PV_STRANGER_KEY[65] = {0x04, 0x95, 0xe0, 0xd2, 0xa8, 0xf0, 0xf9, 0xc2, 0x98, 0xec, 0xd6, 0xa9, 0xbf, 0x91, 0x93, 0x2e, 0x2c, 0xdd, 0x2f, 0x59, 0x8b, 0x75, 0x84, 0x11, 0xed, 0xf7, 0x82, 0xa3, 0x21, 0xb3, 0xd1, 0xaf, 0x9c, 0x2c, 0xc9, 0x5f, 0x35, 0xbc, 0xe5, 0xfc, 0xaa, 0x1c, 0xc9, 0xc3, 0x13, 0xde, 0x16, 0xb9, 0xdc, 0xa0, 0xae, 0xc3, 0xdc, 0x11, 0xdd, 0x0a, 0x7a, 0xe2, 0x18, 0x93, 0xb7, 0xf4, 0x0f, 0x2b, 0x2e};
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
    {"D1", 1, "dede1111-0000-4000-8000-000000000000", "root-key-2026", "op-key-1", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEGcawU1Mg-RtKFbvJuVtoGQQ_HMZZUMMi4I_1P00do7N7XnL7uZZGJqJOfIyNgUl2rk2nb0i3dbDXhZ15WSz3eg", "DIANA_PROVISIONING", 1, "system-a", "rBN6sAsTEEAHLK2239-WM1JuI-HHbBhdpFtLAXhOXYqGvejFdVhKJpXgUAhODQb3hBobGgauh7APLROscE8JjA", "3329e1c86129d8fd69efacac5827f9838ebeb40bfe4132233d7bdc3e96806c22"},
    {"D2", 1, "dede2222-0000-4000-8000-000000000000", "root-key-2026", "op-key-2", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEpNrzV7yiO0AIlFEi78Mn5lXM3EWKSq7sdvM600yznF0SNkCDKUEoevJ-7Z2lQHnxqiNON5zczzX_JcxDUFoiPA", "DIANA_PROVISIONING", 2, "system-a", "lQKWNgCveTVbSOQesmzvTyYvp2ABvlhxdGjyOm5ghasZH1UmST46AcbdyBTb8NuX-D9NBNqbGCWMHwVu50cGVQ", "3cd7ab7a76519a94b2bf80058bb992bf8d4f19671ed7d8ddac7af1847237588e"},
    {"D3", 1, "dede3333-0000-4000-8000-000000000000", "root-key-2026", "op-key-3", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEGcawU1Mg-RtKFbvJuVtoGQQ_HMZZUMMi4I_1P00do7N7XnL7uZZGJqJOfIyNgUl2rk2nb0i3dbDXhZ15WSz3eg", "DIANA_PROVISIONING", 2, "system-a", "4NExAFuydqbn42vCY1kI40H9vF9YgX0ioc2eFbuwwOLbFmWpIuM__vpNWZUnqkCSj2aPZ3YkvLV8sQ7lp7kugg", "1de14086d4accd3f0e63373d856541a6ad0476488e3b11cb806f8e8e0435ff87"},
    {"D4", 1, "dede4444-0000-4000-8000-000000000000", "root-key-2026", "op-key-4", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEGcawU1Mg-RtKFbvJuVtoGQQ_HMZZUMMi4I_1P00do7N7XnL7uZZGJqJOfIyNgUl2rk2nb0i3dbDXhZ15WSz3eg", "DIANA_PROVISIONING", 1, "system-b", "nIWWsJD-5vTYVinsUx0LLxMWhl3u40PCUu348f912fEXJojSvJRGr0ByXGPRMC1x4CJwsOsw2rkeTo9Zyt_Sbw", "9f1118ca006204b3106980f52c0e3a596ec0443177bd2471d14d4fdc2884e599"},
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

static const pv_order PV_ORDERS[8] = {
    {"provision_ok", "PROVISION", "", "system-a", "module-07", 10, "", "", "", "11111111-1111-4111-8111-111111111111", 1750000000000,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "cccccccc-3333-4333-8333-cccccccccccc",
     "b8YqWt-W2wsAso4TXdp_8YUGJjhGIMJpI9WsRzdtBetiCm4dM-kfAIhz-g8J9Xn6HqIZ_LgFn0a94loT_g6HIw",
     "PfFK4jd-O9rrN0syokKA-aBa_TeaDf5G1sJIw3o5i2RHdKYn593ykRbFcR5XnZuD09mB0VRmiXsZXj6S_0kR8Q",
     "2RJSasbNXo5YUGjbKLrdTMjUtl2G_z_IRAWP2ruAijjl7CqBUDbpibSEPoCJaDxQ1C1O0WpQBo-VkjNIt70cJg",
     "79a99508e93bdc84d31c570befdffddea785f8406c55a2bbff926f98f3fbe36b", 247},
    {"provision_ok2", "PROVISION", "", "system-a", "module-07", 40, "", "", "", "33333333-3333-4333-8333-333333333333", 1750000000000,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "dddddddd-4444-4444-8444-dddddddddddd",
     "sWlnuJK2srDqdOJFXq3ikkXNMR8GY5DbrkexSVZSYEWGIlfZ5WBNCm-50LVAiH4bsN5QQL7kNMoZnjg3gBgI6g",
     "Jq6EZR_5JjhjbF7nYRAorpratrnLh8usSkfmAQ6gsBbkpqSFWpGESUHHnNnRLUVCHK49pR0rhPouWRB5dL-M-w",
     "Q4w7FqXZEGTOVYdhCGYqtUc1ZywYAss2uiUMr6V-TD1JK34jiong4rlYFSCDqqrCrPzKodmcBGinkSKwgqF1Uw",
     "ab0145d6b93c051fd56f73f3f6694c9426b23141b968289381517ddc16a71d7d", 247},
    {"provision_other_device", "PROVISION", "", "system-a", "module-99", 11, "", "", "", "11111111-1111-4111-8111-111111111111", 1750000000000,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "cccccccc-3333-4333-8333-cccccccccccc",
     "ivn1ODzH0K6jBHNJ1JEY33-cZMI1_KFV8ANZHs-NlP1eDJInRBilr-tmMoBh6Ff32p176tzgabM6Q0O-NggXSQ",
     "HjF2X8XOs_MULDaQv99uMsM0ZoiYGPSYe47onIRlmT3leaIfAJQyy9G7-jfZLnlVIpB3yDvdQ-ksaqSJZj13dg",
     "P4_wkhjxlHzmvS-sben_jdH8vnitgz93G3gwxc7BNg4JqWw48PlyWrthZo1kDR9_YLu9-ZoFwj4FKfDQGIbJbA",
     "790349d70967977d9c6ffba7b73ec65223d2c7ce552d87d16180056c319b18e4", 247},
    {"provision_bad_fp", "PROVISION", "", "system-a", "module-07", 12, "", "", "", "11111111-1111-4111-8111-111111111111", 1750000000000,
     "2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e", "cccccccc-3333-4333-8333-cccccccccccc",
     "0Q26KO4ATrbUa_bBbl8CCedMPlq73MZ9XFVZNGyGw2f1cFisbt4WqlSAIuulJRHie4lu1F5JKQof2blsp9N-bg",
     "d4roQ4qEksoQ3Ob9Ohx0WclAlsvbIL5nlBEwCWynbbISh0hI-1sUtI-WgM9cC-Ogmw_tQD-0KkfvJRQDEuzd_w",
     "DGYDZhQoGM-2j1xc8QCY2ho8HZueftIQJKIayy553ke2PawWHMckhpDINLDTN3WkhRlj-UIAeC66KQnGvbK9Fg",
     "db98a34f76a34dbadad18a18ef1cae7c0c561e323e93d5164863bd7370b50b49", 247},
    {"prepare_ok", "PREPARE", "NORMAL", "system-a", "module-07", 20, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "", 1750000000000,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "oCX3yDpzy_46SdKxNUI98JDYru2eEs_3VBs0H0joy7xMoOJlIf0EngviO3Tvmgnlx2qg612AmvqyW9LJ4Yd8vw",
     "1dZquKxJYAWbgBiuHDHQ6olkh1sAsNWd7WpaVtgi0h8kbUpg022nLFNUm7M1KbepBSZQA-LPaTwN-TfaVzOn6g",
     "MsMiPIgM016SR-E-I9shkTDe7eLuO0wtZiWZ72CoREBu29cX92mIhB_0gm76gtZc0e6gWqXKKqVytowq_NWWyQ",
     "56466f09377e9355549e8b6cddec15935c9a5e21387726d5dec7b5b8c02c6434", 287},
    {"prepare_stale", "PREPARE", "NORMAL", "system-a", "module-07", 21, "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "33333333-3333-4333-8333-333333333333", "22222222-2222-4222-8222-222222222222", "", 1750000000000,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "M7PpRTmC_vDOMgyAY0ee5nCk_KZWmUxqhHYPVgPfRc0-ugfJ7CuyUQ64iP3RFGOoIYns4RGqfqGbBxmzSNzJgA",
     "HoTWfJKk2AHbjh2TAQE-kTmOvC6TYfG3mf47v6HujDeCTDDgMpOxUNd_3ZSiWNTnsMKOm_fbQDMfbTCDOWFA-A",
     "-_vJwapC6jBvvpNIluLNfL5aoWJx0YGvVirt2We97arIOHG9lJ89AlpJjtrKqoieoEjoTqbNf-epM8q-Jedzug",
     "b3d264977e8e051082835849582ba06d15fd2290fcac5eb18eb8278dc6580959", 287},
    {"commit_ok", "COMMIT", "NORMAL", "system-a", "module-07", 30, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "", "", "", 1750000000000,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "eWEU659VNecQww9P5Av70brf_QiAWJzNT7koAOsoWcxWAIJWrX3rQqjdkysK2L6664V7YFjltD4v2nKEb8qptw",
     "iUmC7EuDWrFcF2M_Sj9CHso5Z7IgEyLaocod7hsOk4H4MS6ceHkthDxYvGDwHqgflG5gxw5G5QJMgV3Zwpv49w",
     "FEcA_Uks2NJE1EZZs4DIpju-p5KIs26zgwHvYuxRbCx-ZpFUrocbfNn-0MoSQAhKBjW_u7r9axRZ-5lLkbWSYg",
     "71eb951f9a0034e6f02e23cc44346215145854e2a5d58a372e71de84e8c2dcd1", 214},
    {"commit_unknown", "COMMIT", "EMERGENCY", "system-a", "module-07", 31, "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "", "", "", 1750000000000,
     "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f", "",
     "KYELlc8gYCJcwP66TaHjC9lJlW9lwVo4nukY37tGhE7SzCotspcX705ERKe5Twh91alUYcH5Tru9icExZgzM2A",
     "JR6bq2P41I_s0pva9CbD4lk6E1GItgEvKRuWR9ym67la4I0X84waTAoYCmscdPBMWSZ-B3B65aYiYxsIvnUNlw",
     "FKSNajEtxb_CRY0yRz2sNSW8IeAEfDr4NAahHgZvYkd-6cR3-aRx7HU1MndQjk-5WwkAaYzLA_bHcFfIZGC1gQ",
     "03158b1cefd40b235d520b4b7a770cf620d64fcf76063cb0c15b595885c6e711", 217},
};

#endif /* DIANA_PROV_VECTORS_H */
