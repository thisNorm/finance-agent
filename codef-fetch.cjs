// Manual read-only approval request. No scheduling until provider limits are confirmed.
const fs=require('node:fs');const crypto=require('node:crypto');
(async()=>{
 const env=process.env;
 for(const k of ['CODEF_CLIENT_ID','CODEF_CLIENT_SECRET','CODEF_CONNECTED_ID','CODEF_ORGANIZATION','CODEF_START_DATE','CODEF_END_DATE'])if(!env[k])throw Error('필수 환경변수 누락: '+k);
 if(!/^\d{8}$/.test(env.CODEF_START_DATE)||!/^\d{8}$/.test(env.CODEF_END_DATE)||env.CODEF_START_DATE>env.CODEF_END_DATE)throw Error('조회 기간을 YYYYMMDD로 확인하세요.');
 const output=process.argv[2];if(!output)throw Error('저장할 새 JSON 파일 경로를 지정하세요.');if(fs.existsSync(output))throw Error('기존 파일을 덮어쓰지 않습니다. 다른 경로를 지정하세요.');
 const tokenResponse=await fetch('https://oauth.codef.io/oauth/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.CODEF_CLIENT_ID+':'+env.CODEF_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials&scope=read',signal:AbortSignal.timeout(30000)});
 if(!tokenResponse.ok)throw Error('CODEF 토큰 요청 실패: HTTP '+tokenResponse.status);
 const token=await tokenResponse.json();if(!token.access_token)throw Error('토큰 응답 형식 오류');
 const params={organization:env.CODEF_ORGANIZATION,connectedId:env.CODEF_CONNECTED_ID,startDate:env.CODEF_START_DATE,endDate:env.CODEF_END_DATE,orderBy:'0',inquiryType:'1',memberStoreInfoType:'0'};
 if(env.CODEF_LOGIN_CARD_NO||env.CODEF_CARD_PASSWORD){if(!env.CODEF_LOGIN_CARD_NO||!env.CODEF_CARD_PASSWORD||!env.CODEF_PUBLIC_KEY)throw Error('카드 인증에는 번호·비밀번호·RSA 공개키가 모두 필요합니다.');params.loginCardNo=env.CODEF_LOGIN_CARD_NO;const key=env.CODEF_PUBLIC_KEY.includes('BEGIN')?env.CODEF_PUBLIC_KEY:'-----BEGIN PUBLIC KEY-----\n'+env.CODEF_PUBLIC_KEY+'\n-----END PUBLIC KEY-----';params.cardPassword=crypto.publicEncrypt({key,padding:crypto.constants.RSA_PKCS1_PADDING},Buffer.from(env.CODEF_CARD_PASSWORD)).toString('base64');}
 const host=env.CODEF_PRODUCTION==='1'?'https://api.codef.io':'https://development.codef.io';
 const response=await fetch(host+'/v1/kr/card/p/account/approval-list',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(300000)});
 if(!response.ok)throw Error('승인내역 조회 실패: HTTP '+response.status);
 const raw=await response.text();let result;try{result=JSON.parse(raw);}catch{result=JSON.parse(decodeURIComponent(raw));}
 if(result.result?.code!=='CF-00000')throw Error('CODEF 조회 실패: '+String(result.result?.code||'응답 형식 오류')+' (자동 재시도하지 않음)');
 const {normalizeImport}=await import('./server/import.js'); 
 // Remove financial identifiers before creating a browser-importable file.
 const clean=normalizeImport(result);
 fs.writeFileSync(output,JSON.stringify(clean,null,2),{flag:'wx',mode:0o600});console.log('승인내역 저장 완료. 데이터 연결에서 JSON 파일을 가져오세요.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
