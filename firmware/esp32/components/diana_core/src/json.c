#include "diana/json.h"

#include <stdio.h>
#include <string.h>

static void put(diana_json *j, char c)
{
    if (j->overflow) return;
    if (j->len + 1 >= j->cap) {
        j->overflow = true;
        return;
    }
    j->buf[j->len++] = c;
    j->buf[j->len] = '\0';
}

static void puts_raw(diana_json *j, const char *s)
{
    for (; *s; ++s) put(j, *s);
}

static void sep(diana_json *j)
{
    if (j->need_comma) put(j, ',');
    j->need_comma = true;
}

void diana_json_init(diana_json *j, char *buf, size_t cap)
{
    j->buf = buf;
    j->cap = cap;
    j->len = 0;
    j->overflow = (cap == 0);
    j->need_comma = false;
    if (cap) buf[0] = '\0';
}

bool diana_json_ok(const diana_json *j) { return !j->overflow; }
size_t diana_json_len(const diana_json *j) { return j->len; }

void diana_json_obj_open(diana_json *j)
{
    sep(j);
    put(j, '{');
    j->need_comma = false;
}

void diana_json_obj_close(diana_json *j)
{
    put(j, '}');
    j->need_comma = true;
}

void diana_json_arr_open(diana_json *j)
{
    put(j, '[');
    j->need_comma = false;
}

void diana_json_arr_close(diana_json *j)
{
    put(j, ']');
    j->need_comma = true;
}

void diana_json_arr_obj_open(diana_json *j)
{
    sep(j);
    put(j, '{');
    j->need_comma = false;
}

static void escaped(diana_json *j, const char *s)
{
    put(j, '"');
    for (; *s; ++s) {
        unsigned char c = (unsigned char)*s;
        switch (c) {
        case '"':  puts_raw(j, "\\\""); break;
        case '\\': puts_raw(j, "\\\\"); break;
        case '\n': puts_raw(j, "\\n");  break;
        case '\r': puts_raw(j, "\\r");  break;
        case '\t': puts_raw(j, "\\t");  break;
        default:
            if (c < 0x20) {
                char tmp[7];
                snprintf(tmp, sizeof(tmp), "\\u%04x", c);
                puts_raw(j, tmp);
            } else {
                put(j, (char)c);
            }
        }
    }
    put(j, '"');
}

void diana_json_key(diana_json *j, const char *key)
{
    if (!key) return;
    sep(j);
    escaped(j, key);
    put(j, ':');
    j->need_comma = false;
}

void diana_json_str(diana_json *j, const char *key, const char *val)
{
    if (key) {
        diana_json_key(j, key);
        escaped(j, val ? val : "");
        j->need_comma = true;
    } else {
        sep(j);
        escaped(j, val ? val : "");
    }
}

void diana_json_int(diana_json *j, const char *key, int64_t val)
{
    char tmp[24];
    snprintf(tmp, sizeof(tmp), "%lld", (long long)val);
    if (key) {
        diana_json_key(j, key);
        puts_raw(j, tmp);
        j->need_comma = true;
    } else {
        sep(j);
        puts_raw(j, tmp);
    }
}

void diana_json_uint(diana_json *j, const char *key, uint64_t val)
{
    char tmp[24];
    snprintf(tmp, sizeof(tmp), "%llu", (unsigned long long)val);
    if (key) {
        diana_json_key(j, key);
        puts_raw(j, tmp);
        j->need_comma = true;
    } else {
        sep(j);
        puts_raw(j, tmp);
    }
}

void diana_json_bool(diana_json *j, const char *key, bool val)
{
    if (key) diana_json_key(j, key);
    else sep(j);
    puts_raw(j, val ? "true" : "false");
    j->need_comma = true;
}

void diana_json_null(diana_json *j, const char *key)
{
    if (key) diana_json_key(j, key);
    else sep(j);
    puts_raw(j, "null");
    j->need_comma = true;
}

void diana_json_num(diana_json *j, const char *key, double val, int decimals)
{
    char fmt[8];
    char tmp[40];
    if (decimals < 0) decimals = 0;
    if (decimals > 9) decimals = 9;
    snprintf(fmt, sizeof(fmt), "%%.%df", decimals);
    snprintf(tmp, sizeof(tmp), fmt, val);
    if (key) diana_json_key(j, key);
    else sep(j);
    puts_raw(j, tmp);
    j->need_comma = true;
}
