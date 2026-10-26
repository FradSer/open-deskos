#include "remote_radio_frame.h"
#include <string.h>
static uint32_t get32(const uint8_t *p) { return p[0] | (uint32_t)p[1]<<8 | (uint32_t)p[2]<<16 | (uint32_t)p[3]<<24; }
static void put32(uint8_t *p, uint32_t n) { for (int i=0; i<4; ++i) p[i]=(uint8_t)(n>>(8*i)); }
bool radio_frame_decode(const uint8_t *data, size_t length, radio_frame_t *frame)
{
    if (!data || !frame || length<RADIO_HEADER || length>250 || memcmp(data,"ODKR",4) || data[4]!=1 ||
        data[5]<RADIO_HELLO || data[5]>RADIO_STATE_ACK || data[22] || data[23]) return false;
    uint16_t total=data[20] | (uint16_t)data[21]<<8;
    uint8_t count=total ? (total+RADIO_CHUNK-1)/RADIO_CHUNK : 1;
    if (!get32(data+8) || total>RADIO_STATE_MAX || data[7]!=count || data[6]>=count ||
        (data[5]!=RADIO_STATE && count!=1)) return false;
    size_t chunk=total-(size_t)data[6]*RADIO_CHUNK;
    if (chunk>RADIO_CHUNK) chunk=RADIO_CHUNK;
    if (length!=RADIO_HEADER+chunk || ((data[5]==RADIO_HELLO || data[5]==RADIO_HELLO_ACK || data[5]==RADIO_STATE_ACK) && total)) return false;
    *frame=(radio_frame_t){.type=data[5],.part=data[6],.count=count,.remote=get32(data+8),
        .host=get32(data+12),.sequence=get32(data+16),.total=total,.payload=data+RADIO_HEADER,.length=chunk};
    return true;
}
size_t radio_frame_encode(uint8_t *data, uint8_t type, uint32_t remote, uint32_t host,
                          uint32_t sequence, const uint8_t *payload, size_t length)
{
    if (!data || !remote || type<RADIO_HELLO || type>RADIO_STATE_ACK || length>RADIO_CHUNK || (length && !payload) || ((type==RADIO_HELLO || type==RADIO_HELLO_ACK || type==RADIO_STATE_ACK) && length)) return 0;
    memset(data,0,RADIO_HEADER); memcpy(data,"ODKR",4); data[4]=1; data[5]=type; data[7]=1;
    put32(data+8,remote); put32(data+12,host); put32(data+16,sequence); data[20]=(uint8_t)length;
    if (length) memcpy(data+RADIO_HEADER,payload,length);
    return RADIO_HEADER+length;
}
bool radio_state_accept(radio_assembly_t *a, const radio_frame_t *f, uint32_t now)
{
    if (!a || !f || f->type!=RADIO_STATE || !f->sequence || !f->total || f->total>RADIO_STATE_MAX ||
        f->count!=(f->total+RADIO_CHUNK-1)/RADIO_CHUNK || f->part>=f->count ||
        f->length!=(f->part+1==f->count ? f->total-f->part*RADIO_CHUNK : RADIO_CHUNK)) return false;
    if (a->sequence && f->sequence<a->sequence) return false;
    if (f->sequence!=a->sequence) {
        memset(a,0,sizeof(*a)); a->sequence=f->sequence; a->total=f->total; a->started_ms=now;
    }
    if (now-a->started_ms>1000 || a->total!=f->total) return false;
    const size_t offset=f->part*RADIO_CHUNK;
    if (a->mask & (1<<f->part)) {
        if (memcmp(a->bytes+offset,f->payload,f->length)) a->started_ms=now-1001;
        return false;
    }
    memcpy(a->bytes+offset,f->payload,f->length); a->mask|=1<<f->part;
    if (a->mask!=(1<<f->count)-1) return false;
    a->bytes[a->total]=0;
    // Embedded terminators cannot hide data from the state parser.
    return memchr(a->bytes,0,a->total)==NULL;
}
