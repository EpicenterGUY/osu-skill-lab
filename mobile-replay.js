/* Safe browser-only osu!standard .osr header reader.
 * Supported: player, beatmap MD5, hit counts, score, combo, mods, accuracy.
 * Input frames are LZMA-compressed and deliberately NOT claimed as parsed.
 * https://osu.ppy.sh/wiki/en/Client/File_formats/osr_%28file_format%29
 */
const OSLReplay = {
  parse(bytes) {
    const view = new DataView(bytes);
    const utf8 = new TextDecoder("utf-8", {fatal: false});
    let offset = 0;
    function requireBytes(n) {
      if(n<0 || n>view.byteLength-offset) throw Error("손상되었거나 잘린 .osr 파일입니다.");
    }
    function u8() {requireBytes(1); return view.getUint8(offset++);}
    function u16() {requireBytes(2); const value=view.getUint16(offset,true); offset+=2; return value;}
    function u32() {requireBytes(4); const value=view.getUint32(offset,true); offset+=4; return value;}
    function uleb() {
      let value=0,mult=1;
      for(let i=0;i<5;i++){
        const b=u8(); value+=(b&0x7f)*mult;
        if(!(b&0x80))return value;
        mult*=128;
      }
      throw Error(".osr 텍스트 길이 형식 오류");
    }
    function str(){
      const marker=u8();
      if(marker===0)return "";
      if(marker!==11)throw Error("잘못된 .osr 문자열 형식");
      const len=uleb();
      if(len>300000)throw Error(".osr 문자열 크기가 비정상적입니다.");
      requireBytes(len);
      const value=utf8.decode(new Uint8Array(bytes,offset,len));
      offset+=len;
      return value;
    }
    if(view.byteLength<45)throw Error(".osr 파일이 너무 짧습니다.");
    const mode=u8();
    if(mode!==0)throw Error("현재 osu!standard 리플레이(.osr)만 지원합니다.");
    const game_version=u32(),map_hash=str(),player=str(),replay_hash=str();
    const n300=u16(),n100=u16(),n50=u16(),nGeki=u16(),nKatu=u16(),miss=u16();
    const score=u32(),combo=u16(),perfect=Boolean(u8()),mods=u32(),life=str();
    requireBytes(8);
    const tickLow=BigInt(view.getUint32(offset,true)), tickHigh=BigInt(view.getUint32(offset+4,true));
    const windowsTicks=(tickHigh<<32n)|tickLow; offset+=8;
    let replay_timestamp=null;
    try{
      const unixTicks=windowsTicks-621355968000000000n;
      const ms=Number(unixTicks/10000n);
      if(Number.isFinite(ms)&&ms>0)replay_timestamp=new Date(ms).toISOString();
    }catch(_){}
    const compressedLength=u32();
    if(compressedLength!==0xffffffff){
      requireBytes(compressedLength);
      offset+=compressedLength; // LZMA frames, intentionally not decoded.
    }
    const denominator=n300+n100+n50+miss;
    const accuracy=denominator?
      ((300*n300+100*n100+50*n50)/(300*denominator))*100:null;
    const judged=denominator||0, non300=n100+n50+miss;
    return{
      mode,game_version,map_hash:String(map_hash||"").toLowerCase(),player,replay_hash,score,combo,perfect,mods,
      hits:{great:n300,good:n100,meh:n50,geki:nGeki,katu:nKatu,miss},
      accuracy:accuracy==null?null:Math.round(accuracy*100)/100,
      judged,non300,
      miss_rate:judged?Math.round(miss/judged*10000)/100:null,
      non300_rate:judged?Math.round(non300/judged*10000)/100:null,
      replay_timestamp,
      header_only:true,taps:null,median_gap:null,bursts:[],
      replay_data_analyzed:false
    };
  }
};
