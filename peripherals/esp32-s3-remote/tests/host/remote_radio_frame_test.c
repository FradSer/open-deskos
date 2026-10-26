#include <assert.h>
#include <string.h>
#include "remote_radio_frame.h"
static void put32(uint8_t *p,uint32_t n) { for (int i=0;i<4;i++) p[i]=(uint8_t)(n>>(i*8)); }
static size_t fragment(uint8_t *bytes, uint8_t part, uint32_t sequence, uint8_t value)
{
    // Same golden header as the host codec test; total=512 and count=3.
    const uint8_t golden[]={0x4f,0x44,0x4b,0x52,1,4,0,3,1,0,0,0,2,0,0,0,3,0,0,0,0,2,0,0};
    memcpy(bytes,golden,sizeof(golden)); bytes[6]=part; put32(bytes+16,sequence);
    size_t size=part==2 ? 60 : 226; memset(bytes+24,value,size); return 24+size;
}
int main(void)
{
    uint8_t bytes[250]; radio_frame_t f; radio_assembly_t a={0};
    size_t size=fragment(bytes,0,3,'A'); assert(radio_frame_decode(bytes,size,&f));
    assert(f.remote==1 && f.host==2 && f.sequence==3 && f.total==512);
    assert(!radio_state_accept(&a,&f,100));
    assert(!radio_state_accept(&a,&f,101)); // Duplicate fragments do not commit twice.
    size=fragment(bytes,2,3,'C'); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,102));
    size=fragment(bytes,1,3,'B'); assert(radio_frame_decode(bytes,size,&f)); assert(radio_state_accept(&a,&f,103));
    assert(a.bytes[0]=='A' && a.bytes[226]=='B' && a.bytes[452]=='C' && a.bytes[512]==0);
    assert(!radio_state_accept(&a,&f,104));
    size=fragment(bytes,0,2,'X'); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,105));
    memset(&a,0,sizeof(a));
    size=fragment(bytes,0,4,'A'); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,100));
    size=fragment(bytes,1,4,'B'); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,1101));
    size=fragment(bytes,2,4,'C'); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,1102));
    memset(&a,0,sizeof(a));
    size=fragment(bytes,0,5,'A'); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,100));
    bytes[24]='X'; assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,101));
    size=fragment(bytes,1,5,'B'); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,102));
    size=fragment(bytes,2,5,'C'); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,103));
    size=fragment(bytes,0,6,0); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,200));
    size=fragment(bytes,1,6,'B'); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,201));
    size=fragment(bytes,2,6,'C'); assert(radio_frame_decode(bytes,size,&f)); assert(!radio_state_accept(&a,&f,202));
    for (size_t i=0;i<24;i++) { uint8_t saved=bytes[i]; bytes[i]^=255; if (i<8 || i>=20) assert(!radio_frame_decode(bytes,size,&f)); bytes[i]=saved; }
    assert(!radio_frame_decode(bytes,size-1,&f));
    size=radio_frame_encode(bytes,RADIO_HELLO,1,2,0,NULL,0); assert(size==24 && radio_frame_decode(bytes,size,&f));
    assert(f.type==RADIO_HELLO && f.remote==1 && f.host==2 && f.total==0);
    return 0;
}
