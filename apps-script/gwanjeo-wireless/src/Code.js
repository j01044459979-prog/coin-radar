const SPREADSHEET_ID='1Y8ul3iXrwdPjzZvMWeBQMmOSdumrF7ysN_ciIQRjGCs';
const TZ='Asia/Seoul';

const SPOT_HEADERS=[
'등록일시','적용월','구분','항목명','시작일','종료일','금액','비고',
'ID','계산방식','실적기준','건당금액','1차목표','1차건당금액',
'2차목표','2차건당금액','3차목표','3차건당금액','순번'
];

/*
 * 스팟완료 기록 (월별 장표와 분리된 별도 시트)
 * 스팟별 × 개통건별 완료 상태를 관리
 */
const SPOT_DONE_SHEET='스팟완료기록';

const SPOT_DONE_HEADERS=[
'스팟ID','개통월','CTN','고객명','개통일','완료','처리일시'
];

const RISK_HEADERS=[
'등록일시','적용월','CTN','고객명','개통일','직원명','카드1','카드2','완료','메모'
];

function doGet(){
  return HtmlService.createHtmlOutputFromFile('index')
  .setTitle('관저중로점 무선 실적')
  .addMetaTag(
    'viewport',
    'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
  );
}

function norm(v){
  return String(v==null?'':v)
  .replace(/\s/g,'')
  .toUpperCase();
}

function phone(v){
  var s=String(v==null?'':v)
  .replace(/\D/g,'');

  if(/^10\d{8}$/.test(s)){
    s='0'+s;
  }

  return s;
}

function normalizeModel(v){
  return String(v==null?'':v)
  .trim()
  .toUpperCase()
  .replace(/\s+/g,'')
  .replace(/^SM[-_]?/i,'');
}

function monthKey(v){

  if(v instanceof Date&&!isNaN(v.getTime())){
    return Utilities.formatDate(
      v,
      TZ,
      'yyyy-MM'
    );
  }

  if(typeof v==='number'&&isFinite(v)){
    return Utilities.formatDate(
      new Date(
        Date.UTC(1899,11,30)+
        v*86400000
      ),
      TZ,
      'yyyy-MM'
    );
  }

  var s=String(v==null?'':v).trim();

  if(/^20\d{2}-\d{2}$/.test(s)){
    return s;
  }

  var m=s.match(
    /^(\d{2}|\d{4})년\s*(\d{1,2})월$/
  );

  if(!m){
    return s;
  }

  return(
    (m[1].length===2?'20':'')+
    m[1]+'-'+
    String(Number(m[2])).padStart(2,'0')
  );
}

function displayMonthKey(mk){

  var m=String(mk||'')
  .match(
    /^(\d{4})-(\d{2})$/
  );

  return m
    ?m[1]+'년 '+Number(m[2])+'월'
    :mk;
}

function amount(v){

  if(
    v===''||
    v==null||
    /^[-–—X]$/i.test(
      String(v).trim()
    )
  ){
    return 0;
  }

  var s=String(v)
  .replace(
    /[,\s₩원]/g,
    ''
  );

  if(
    !/^-?\d+(?:\.0+)?$/.test(s)
  ){
    throw new Error(
      '금액 확인 필요: '+v
    );
  }

  var n=Number(s);

  if(!Number.isSafeInteger(n)){
    throw new Error(
      '금액이 너무 큽니다.'
    );
  }

  return n;
}

function inputAmount(v){

  var n=amount(v);

  if(n<0){
    throw new Error(
      '금액은 0 이상이어야 합니다.'
    );
  }

  return n;
}

function policyAmount(v){

  var s=String(
    v==null?'':v
  ).trim();

  if(
    !s||
    /^[-X]$/i.test(s)
  ){
    return 0;
  }

  var n=amount(s);

  return(
    n>0&&n<1000
      ?n*10000
      :n
  );
}

function validDate(s){

  if(
    !/^\d{4}-\d{2}-\d{2}$/
    .test(
      String(s||'')
    )
  ){
    return false;
  }

  var d=
    new Date(
      s+'T00:00:00Z'
    );

  return(
    !isNaN(d.getTime())&&
    d.toISOString()
    .slice(0,10)===s
  );
}

function dateValue(v,mk){

  if(v instanceof Date){

    return Utilities.formatDate(
      v,
      TZ,
      'yyyy-MM-dd'
    );
  }

  if(typeof v==='number'){

    return new Date(
      Date.UTC(1899,11,30)+
      v*86400000
    )
    .toISOString()
    .slice(0,10);
  }

  var s=String(v||'').trim();

  if(!s){
    return '';
  }

  if(validDate(s)){
    return s;
  }

  var m=s.match(
    /^(\d{2,4})[.\/-](\d{1,2})[.\/-](\d{1,2})\.?$/
  );

  if(m){

    var y=
      m[1].length===2
        ?'20'+m[1]
        :m[1];

    var out=
      y+'-'+
      String(
        Number(m[2])
      ).padStart(2,'0')+
      '-'+
      String(
        Number(m[3])
      ).padStart(2,'0');

    return validDate(out)
      ?out
      :'';
  }

  m=s.match(
    /^(\d{1,2})\s*(?:월|[.\/-])\s*(\d{1,2})\s*일?$/
  );

  if(
    m&&
    /^20\d{2}-\d{2}$/
    .test(
      String(mk||'')
    )
  ){

    var out2=
      mk.slice(0,4)+'-'+
      String(
        Number(m[1])
      ).padStart(2,'0')+
      '-'+
      String(
        Number(m[2])
      ).padStart(2,'0');

    return validDate(out2)
      ?out2
      :'';
  }

  return '';
}

function randomId(prefix){

  return(
    (prefix||'id')+
    '-'+
    new Date().getTime()+
    '-'+
    Math.random()
    .toString(36)
    .slice(2,10)
  );
}

function todayString(){

  return Utilities.formatDate(
    new Date(),
    TZ,
    'yyyy-MM-dd'
  );
}

function safeCell(v){
  return v==null?'':v;
}

function setMoneyCell(
  sh,
  row,
  col,
  value
){

  var cell=
    sh.getRange(
      row,
      col
    );

  cell.setValue(
    value>0
      ?value
      :''
  );

  cell.setNumberFormat(
    '#,##0'
  );
}

function getMonthlySheets_(ss){

  return ss.getSheets()
  .map(function(sh){

    return{
      sh:sh,
      key:monthKey(
        sh.getName()
      ),
      title:sh.getName()
    };
  })
  .filter(function(x){

    return(
      /^20\d{2}-\d{2}$/
      .test(x.key)&&
      x.key>='2026-09'
    );
  })
  .sort(function(a,b){

    return b.key
    .localeCompare(a.key);
  });
}


/* =========================================================
   월 장표 열 구조 (데이터 10행부터)
   장표가 원본이며 웹앱은 A/B 및 N~ 예산 영역에 쓰지 않음

   A 검수완료   B 메모     C No.     D 개통일
   E 고객       F CTN      G 종류    H 모델명
   J 요금제     M 직원명   N 총 확보금액   Z 총 사용금액
========================================================= */

var CASE_HEADERS_=[
  {col:1, label:'검수완료'},
  {col:2, label:'메모'},
  {col:3, label:'No'},
  {col:4, label:'개통일'},
  {col:5, label:'고객'},
  {col:6, label:'CTN'},
  {col:7, label:'종류'},
  {col:8, label:'모델명'},
  {col:10,label:'요금제'},
  {col:13,label:'직원명'},
  {col:14,label:'총확보금액'},
  {col:26,label:'총사용금액'}
];

/*
 * 헤더 위치 확인 (읽기 전용)
 * 1~9행 중 해당 열에 기대하는 제목이 있는지만 확인
 * 반환: 불일치 목록 (없으면 빈 배열)
 */
function checkCaseHeaders_(sh){

  var head=
    sh.getRange(1,1,9,26)
    .getDisplayValues();

  var problems=[];

  CASE_HEADERS_.forEach(
    function(h){

      var text=
        head.map(
          function(r){
            return norm(r[h.col-1]);
          }
        ).join('|');

      if(
        text.indexOf(
          norm(h.label)
        )<0
      ){

        problems.push(
          sh.getRange(1,h.col)
          .getA1Notation()
          .replace(/\d+/,'')+
          '열 \''+h.label+'\''
        );
      }
    }
  );

  return problems;
}


/* =========================================================
   월 장표 읽기
========================================================= */

function readCases_(
  ss,
  onlyMonth
){

  var cases=[];
  var months=[];
  var warnings=[];

  var allSheets=
    getMonthlySheets_(ss);

  allSheets.forEach(
    function(info){

      months.push({
        key:info.key,
        title:info.title
      });
    }
  );

  var targetSheets=
    allSheets.filter(
      function(info){

        return(
          !onlyMonth||
          info.key===onlyMonth
        );
      }
    );

  targetSheets.forEach(
    function(info){

      var sh=info.sh;

      var headerProblems=
        checkCaseHeaders_(sh);

      if(headerProblems.length){

        warnings.push(
          info.title+
          ' 헤더 확인 필요: '+
          headerProblems.join(', ')
        );
      }

      if(
        sh.getLastRow()<10
      ){
        return;
      }

      var lastRow=
        sh.getLastRow();

      var count=
        lastRow-9;

      if(count<=0){
        return;
      }

      var ids=
        sh.getRange(
          10,
          5,
          count,
          2
        )
        .getDisplayValues();

      var lastOffset=-1;

      for(
        var z=ids.length-1;
        z>=0;
        z--
      ){

        var nm=
          String(
            ids[z][0]||''
          ).trim();

        var ph=
          phone(
            ids[z][1]
          );

        if(
          nm||
          /^01\d{8,9}$/
          .test(ph)
        ){

          lastOffset=z;
          break;
        }
      }

      if(lastOffset<0){
        return;
      }

      var realLastRow=
        10+lastOffset;

      var rows=
        sh.getRange(
          10,
          1,
          realLastRow-9,
          44
        )
        .getValues();

      rows.forEach(
        function(r,idx){

          var row=
            idx+10;

          var reviewed=
            r[0]===true||
            norm(r[0])==='TRUE'||
            norm(r[0])==='O'||
            norm(r[0])==='완료';

          var memo=
            String(
              safeCell(r[1])
            ).trim();

          var name=
            String(
              safeCell(r[4])
            ).trim();

          var tel=
            phone(r[5]);

          if(
            !name||
            !/^01\d{8,9}$/
            .test(tel)
          ){
            return;
          }

          var d=
            dateValue(
              r[3],
              info.key
            );

          if(!d){

            warnings.push(
              info.title+
              ' '+
              row+
              '행: 개통일 확인 필요'
            );
          }

          var type=
            String(
              safeCell(r[6])
            ).trim();

          var model=
            normalizeModel(
              r[7]
            );

          var plan=
            String(
              safeCell(r[9])
            ).trim();

          var staff=
            String(
              safeCell(r[12])
            ).trim()||
            '미지정';


          /*
           * 확보금액 = N열 총 확보금액
           */

          var secured=
            amount(r[13]);


          /*
           * 기존 개별 필드는
           * 필요한 실적 판정용으로 유지
           */

          var spot1=
            amount(r[14]);

          var spotNote1=
            String(
              safeCell(r[15])
            ).trim();

          var spot2=
            amount(r[16]);

          var spotNote2=
            String(
              safeCell(r[17])
            ).trim();


          /*
           * Y열 고객혜택 개별값
           */

          var benefit=
            amount(r[24]);


          /*
           * Z열 = 총 사용금액
           * 고객에게 사용한 모든 금액
           */

          var totalUsed=
            amount(r[25]);


          var useDevice=
            amount(r[26]);

          var useGbDevice=
            amount(r[27]);

          var useGbPlan=
            amount(r[28]);


          var secondRaw=
            norm(r[20])||
            norm(r[30]);

          var cardRaw=
            norm(r[37]);

          var planN=
            norm(plan);

          var typeN=
            norm(type);


          cases.push({

            key:
              info.key+
              '|'+tel+
              '|'+row,

            month:
              info.key,

            sheet:
              info.title,

            row:
              row,

            no:
              String(
                safeCell(r[2])
              ).trim(),

            date:
              d,

            name:
              name,

            phone:
              tel,

            type:
              type,

            model:
              model,

            plan:
              plan,

            staff:
              staff,

            reviewed:
              reviewed,

            memo:
              memo,


            /*
             * 확보금액
             * N열 총 확보금액
             */

            secured:
              secured,


            /*
             * 고객에게 사용한 전체 금액
             * Z열
             */

            used:
              totalUsed,


            /*
             * 개통건별 잔여 = N - Z
             * 스팟은 개별 고객에게 배분하지 않음
             */

            remaining:
              secured-
              totalUsed,


            post:1,

            mnp:
              /MNP|번이|번호이동/
              .test(typeN)
                ?1
                :0,

            choice:
              /스초|더블디초|120|유[튜투]브넷초|더블넷유초스/
              .test(planN)
                ?1
                :0,

            house:
              planN.indexOf(
                '가구초'
              )>=0
                ?1
                :0,

            second:
              secondRaw&&
              ![
                '0',
                'X',
                '-'
              ].includes(
                secondRaw
              )
                ?1
                :0,

            card:
              cardRaw&&
              ![
                '0',
                'X',
                '-'
              ].includes(
                cardRaw
              )
                ?1
                :0,


            /*
             * 기존 호환용
             * benefit도 고객혜택 확보금액으로 통일
             */

            benefit:
              secured,

            spot1:
              spot1,

            spotNote1:
              spotNote1,

            spot2:
              spot2,

            spotNote2:
              spotNote2,

            useDevice:
              useDevice,

            useGbDevice:
              useGbDevice,

            useGbPlan:
              useGbPlan,

            totalUsed:
              totalUsed
          });
        }
      );
    }
  );

  cases.sort(
    function(a,b){

      var ad=
        a.date||'';

      var bd=
        b.date||'';

      if(ad!==bd){

        return bd.localeCompare(
          ad
        );
      }

      var an=
        Number(a.no)||0;

      var bn=
        Number(b.no)||0;

      if(an!==bn){
        return bn-an;
      }

      return b.row-a.row;
    }
  );

  return{
    cases:cases,
    months:months,
    warnings:warnings
  };
}


/* =========================================================
   예산 저장
   현재 웹에서는 장표 조회용으로 사용하지만
   기존 함수 호환을 위해 유지
========================================================= */

function saveCaseBudget(x){

  var lock=
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    if(
      !x||
      !x.sheet||
      !x.row||
      !x.phone
    ){

      throw new Error(
        '저장할 개통건 정보가 없습니다.'
      );
    }

    var ss=
      SpreadsheetApp.openById(
        SPREADSHEET_ID
      );

    var sh=
      ss.getSheetByName(
        String(x.sheet)
      );

    if(!sh){

      throw new Error(
        '대상 월별 시트를 찾지 못했습니다.'
      );
    }

    var row=
      Number(x.row);

    if(
      !Number.isInteger(row)||
      row<10
    ){

      throw new Error(
        '행 정보가 올바르지 않습니다.'
      );
    }

    var currentPhone=
      phone(
        sh.getRange(
          row,
          6
        ).getValue()
      );

    if(
      currentPhone!==
      phone(x.phone)
    ){

      throw new Error(
        '개통건 위치가 변경되었습니다. 새로고침 후 다시 저장해주세요.'
      );
    }

    SpreadsheetApp.flush();

    return{
      saved:true,
      sheet:sh.getName(),
      row:row
    };

  }finally{

    lock.releaseLock();
  }
}


/* =========================================================
   스팟
========================================================= */

function ensureSpotSheet_(
  ss,
  write
){

  var sh=
    ss.getSheetByName(
      '공용재원'
    );

  if(!sh){

    if(!write){
      return null;
    }

    sh=
      ss.insertSheet(
        '공용재원'
      );

    sh.getRange(
      1,
      1,
      1,
      SPOT_HEADERS.length
    )
    .setValues([
      SPOT_HEADERS
    ]);

    return sh;
  }

  if(
    sh.getMaxColumns()<19
  ){

    if(!write){
      return sh;
    }

    sh.insertColumnsAfter(
      sh.getMaxColumns(),
      19-
      sh.getMaxColumns()
    );
  }

  if(
    write&&
    !String(
      sh.getRange(
        1,
        19
      ).getValue()||''
    ).trim()
  ){

    sh.getRange(
      1,
      19
    )
    .setValue(
      '순번'
    );
  }

  return sh;
}

function readSpots_(
  ss,
  cases,
  today,
  onlyMonth
){

  var sh=
    ensureSpotSheet_(
      ss,
      false
    );

  if(
    !sh||
    sh.getLastRow()<2
  ){
    return [];
  }

  if(
    sh.getMaxColumns()<19
  ){
    return [];
  }

  var rows=
    sh.getRange(
      2,
      1,
      sh.getLastRow()-1,
      19
    )
    .getValues();

  var list=[];

  var doneMap=
    readSpotDoneMap_(ss);

  rows.forEach(
    function(r,idx){

      if(
        !String(
          r[3]||''
        ).trim()
      ){
        return;
      }

      var mk=
        monthKey(
          r[1]
        );

      if(
        onlyMonth&&
        mk!==onlyMonth
      ){
        return;
      }

      var mode=
        String(
          r[9]||''
        ).trim();

      if(
        mode==='목표정액'||
        mode==='정액'
      ){
        mode=
          '구간정액';
      }

      if(
        mode==='목표건당'||
        mode==='건당'
      ){
        mode=
          '구간건당';
      }

      var f={

        row:
          idx+2,

        id:
          String(
            r[8]||
            (
              'legacy-'+
              (idx+2)
            )
          ),

        sequence:
          Number(r[18])||
          (idx+1),

        month:
          mk,

        name:
          String(
            r[3]||''
          ).trim(),

        start:
          dateValue(
            r[4],
            mk
          ),

        end:
          dateValue(
            r[5],
            mk
          ),

        note:
          String(
            r[7]||''
          ).trim(),

        mode:
          mode,

        metric:
          String(
            r[10]||
            'post'
          ).trim()||
          'post',

        tier1Target:
          amount(r[12]),

        tier1Value:
          amount(r[13]),

        tier2Target:
          amount(r[14]),

        tier2Value:
          amount(r[15]),

        tier3Target:
          amount(r[16]),

        tier3Value:
          amount(r[17])
      };

      list.push(
        calculateSpot_(
          f,
          cases,
          today,
          doneMap
        )
      );
    }
  );

  list.sort(
    function(a,b){

      return(
        b.sequence-
        a.sequence
      );
    }
  );

  return list;
}

function spotTiers_(f){

  var tiers=[

    {
      no:1,
      target:
        Number(
          f.tier1Target
        )||0,
      value:
        Number(
          f.tier1Value
        )||0
    },

    {
      no:2,
      target:
        Number(
          f.tier2Target
        )||0,
      value:
        Number(
          f.tier2Value
        )||0
    },

    {
      no:3,
      target:
        Number(
          f.tier3Target
        )||0,
      value:
        Number(
          f.tier3Value
        )||0
    }
  ]
  .filter(
    function(t){

      return(
        t.target>0&&
        t.value>0
      );
    }
  );

  tiers.sort(
    function(a,b){

      return(
        a.target-
        b.target
      );
    }
  );

  return tiers;
}

function calculateSpot_(
  f,
  cases,
  today,
  doneMap
){

  var eligible=
    cases.filter(
      function(c){

        return(
          c.date&&
          f.start&&
          f.end&&
          c.date>=f.start&&
          c.date<=f.end
        );
      }
    );

  /*
   * 대상건 = 기간 내 + 실적기준 해당 개통건
   * 예산 반영 건수(count) = 대상건 중 스팟완료 체크된 건만
   */

  var targets=
    eligible
    .filter(
      function(c){

        return(
          (
            Number(
              c[f.metric]
            )||0
          )>0
        );
      }
    )
    .map(
      function(c){

        return{
          month:c.month,
          date:c.date,
          name:c.name,
          phone:c.phone,
          staff:c.staff,
          done:
            !!(
              doneMap&&
              doneMap[
                spotDoneKey_(
                  f.id,
                  c.month,
                  c.phone
                )
              ]
            )
        };
      }
    )
    .sort(
      function(a,b){

        return(
          String(a.date)
          .localeCompare(
            String(b.date)
          )||
          String(a.name)
          .localeCompare(
            String(b.name),
            'ko'
          )
        );
      }
    );

  var doneCount=
    targets.filter(
      function(t){
        return t.done;
      }
    ).length;

  var count=
    doneCount;

  var achieved=null;

  spotTiers_(f)
  .forEach(
    function(t){

      if(
        count>=t.target
      ){
        achieved=t;
      }
    }
  );

  var total=0;
  var status='진행중';

  if(achieved){

    total=
      f.mode==='구간건당'
        ?count*
          achieved.value
        :achieved.value;

    status=
      achieved.no+
      '차 달성';

  }else if(
    f.end&&
    today>f.end
  ){

    status=
      '미달성';
  }

  return Object.assign(
    {},
    f,
    {
      count:count,
      total:total,
      status:status,

      targets:
        targets,

      targetCount:
        targets.length,

      doneCount:
        doneCount,

      pendingCount:
        targets.length-
        doneCount,

      appliedTier:
        achieved
          ?achieved.no
          :0,

      appliedTarget:
        achieved
          ?achieved.target
          :0,

      appliedValue:
        achieved
          ?achieved.value
          :0,

      tiers:
        spotTiers_(f)
    }
  );
}

function saveSpot(x){

  var lock=
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    if(!x){

      throw new Error(
        '저장할 스팟 정보가 없습니다.'
      );
    }

    var name=
      String(
        x.name||''
      ).trim();

    if(!name){

      throw new Error(
        '스팟명을 입력하세요.'
      );
    }

    if(
      !validDate(x.start)||
      !validDate(x.end)
    ){

      throw new Error(
        '적용기간을 확인하세요.'
      );
    }

    if(
      x.start>x.end
    ){

      throw new Error(
        '종료일은 시작일 이후여야 합니다.'
      );
    }

    var month=
      monthKey(
        x.month
      );

    if(
      !/^20\d{2}-(0[1-9]|1[0-2])$/
      .test(month)
    ){

      throw new Error(
        '귀속월을 확인하세요.'
      );
    }

    var mode=
      String(
        x.mode||
        '구간정액'
      ).trim();

    if(
      mode==='목표정액'||
      mode==='정액'
    ){
      mode=
        '구간정액';
    }

    if(
      mode==='목표건당'||
      mode==='건당'
    ){
      mode=
        '구간건당';
    }

    if(
      [
        '구간정액',
        '구간건당'
      ].indexOf(
        mode
      )===-1
    ){

      throw new Error(
        '지급방식을 확인하세요.'
      );
    }

    var metric=
      String(
        x.metric||
        'post'
      ).trim();

    if(
      [
        'post',
        'mnp',
        'choice',
        'house',
        'second',
        'card'
      ].indexOf(
        metric
      )===-1
    ){

      throw new Error(
        '실적기준을 확인하세요.'
      );
    }

    var t1=
      inputAmount(
        x.tier1Target||0
      );

    var v1=
      inputAmount(
        x.tier1Value||0
      );

    var t2=
      inputAmount(
        x.tier2Target||0
      );

    var v2=
      inputAmount(
        x.tier2Value||0
      );

    var t3=
      inputAmount(
        x.tier3Target||0
      );

    var v3=
      inputAmount(
        x.tier3Value||0
      );

    if(
      t1<=0||
      v1<=0
    ){

      throw new Error(
        '1차 목표와 금액은 필수입니다.'
      );
    }

    if(
      (t2>0)!==
      (v2>0)
    ){

      throw new Error(
        '2차 목표와 금액을 함께 입력하세요.'
      );
    }

    if(
      (t3>0)!==
      (v3>0)
    ){

      throw new Error(
        '3차 목표와 금액을 함께 입력하세요.'
      );
    }

    if(
      t2>0&&
      t2<=t1
    ){

      throw new Error(
        '2차 목표는 1차보다 커야 합니다.'
      );
    }

    if(
      t3>0&&
      t2<=0
    ){

      throw new Error(
        '3차 목표를 쓰려면 2차 목표도 입력하세요.'
      );
    }

    if(
      t3>0&&
      t3<=t2
    ){

      throw new Error(
        '3차 목표는 2차보다 커야 합니다.'
      );
    }

    var ss=
      SpreadsheetApp.openById(
        SPREADSHEET_ID
      );

    var sh=
      ensureSpotSheet_(
        ss,
        true
      );

    var requestedId=
      String(
        x.id||''
      ).trim();

    var id=
      requestedId||
      randomId('spot');

    var row=0;
    var seq=0;

    if(
      requestedId&&
      sh.getLastRow()>=2
    ){

      var ids=
        sh.getRange(
          2,
          9,
          sh.getLastRow()-1,
          1
        )
        .getDisplayValues();

      for(
        var i=0;
        i<ids.length;
        i++
      ){

        if(
          String(
            ids[i][0]||''
          ).trim()===
          requestedId
        ){

          row=i+2;
          break;
        }
      }
    }

    if(row>0){

      seq=
        Number(
          sh.getRange(
            row,
            19
          ).getValue()
        )||0;

      if(!seq){

        var editMax=0;

        if(
          sh.getLastRow()>=2
        ){

          sh.getRange(
            2,
            19,
            sh.getLastRow()-1,
            1
          )
          .getValues()
          .forEach(
            function(r){

              editMax=
                Math.max(
                  editMax,
                  Number(r[0])||0
                );
            }
          );
        }

        seq=
          editMax+1;
      }

    }else{

      row=
        Math.max(
          2,
          sh.getLastRow()+1
        );

      var maxSeq=0;

      if(
        sh.getLastRow()>=2
      ){

        sh.getRange(
          2,
          19,
          sh.getLastRow()-1,
          1
        )
        .getValues()
        .forEach(
          function(r){

            maxSeq=
              Math.max(
                maxSeq,
                Number(r[0])||0
              );
          }
        );
      }

      seq=
        maxSeq+1;
    }

    sh.getRange(
      row,
      1,
      1,
      19
    )
    .setValues([[
      new Date(),
      month,
      '스팟',
      name,
      x.start,
      x.end,
      0,
      String(
        x.note||''
      ).trim(),
      id,
      mode,
      metric,
      0,
      t1,
      v1,
      t2,
      v2,
      t3,
      v3,
      seq
    ]]);

    sh.getRange(
      row,
      2
    )
    .setNumberFormat('@')
    .setValue(month);

    sh.getRange(
      row,
      13,
      1,
      6
    )
    .setNumberFormat(
      '#,##0'
    );

    SpreadsheetApp.flush();

    return{
      saved:true,
      id:id,
      sequence:seq,
      row:row,
      month:month
    };

  }finally{

    lock.releaseLock();
  }
}


/* =========================================================
   스팟완료 기록
   월별 장표에는 쓰지 않고 '스팟완료기록' 시트에만 기록
========================================================= */

function spotDoneKey_(
  spotId,
  month,
  tel
){

  return(
    String(spotId||'').trim()+
    '|'+
    String(month||'').trim()+
    '|'+
    phone(tel)
  );
}

function readSpotDoneMap_(ss){

  var map={};

  var sh=
    ss.getSheetByName(
      SPOT_DONE_SHEET
    );

  if(
    !sh||
    sh.getLastRow()<2
  ){
    return map;
  }

  sh.getRange(
    2,
    1,
    sh.getLastRow()-1,
    SPOT_DONE_HEADERS.length
  )
  .getValues()
  .forEach(
    function(r){

      var done=
        r[5]===true||
        norm(r[5])==='TRUE';

      if(done){

        map[
          spotDoneKey_(
            r[0],
            monthKey(r[1]),
            r[2]
          )
        ]=true;
      }
    }
  );

  return map;
}

function ensureSpotDoneSheet_(ss){

  var sh=
    ss.getSheetByName(
      SPOT_DONE_SHEET
    );

  if(!sh){

    sh=
      ss.insertSheet(
        SPOT_DONE_SHEET
      );

    sh.getRange(
      1,
      1,
      1,
      SPOT_DONE_HEADERS.length
    )
    .setValues([
      SPOT_DONE_HEADERS
    ]);
  }

  return sh;
}

/*
 * 스팟완료 체크/해제
 * x = {spotId, month(개통월), phone, done}
 * 대상건 여부를 서버에서 다시 확인한 뒤 기록
 */
function setSpotCompletion(x){

  var lock=
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    var spotId=
      String(
        x&&x.spotId||''
      ).trim();

    var month=
      monthKey(
        x&&x.month
      );

    var tel=
      phone(
        x&&x.phone
      );

    var done=
      !!(x&&x.done);

    if(
      !spotId||
      !/^20\d{2}-\d{2}$/.test(month)||
      !/^01\d{8,9}$/.test(tel)
    ){

      throw new Error(
        '스팟완료 처리 정보가 올바르지 않습니다.'
      );
    }

    var ss=
      SpreadsheetApp.openById(
        SPREADSHEET_ID
      );

    var model=
      readCases_(
        ss,
        month
      );

    var spot=
      readSpots_(
        ss,
        model.cases,
        todayString(),
        month
      )
      .find(
        function(s){
          return s.id===spotId;
        }
      );

    if(!spot){

      throw new Error(
        '스팟을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.'
      );
    }

    var target=
      spot.targets.find(
        function(t){

          return(
            t.month===month&&
            t.phone===tel
          );
        }
      );

    if(!target){

      throw new Error(
        '해당 스팟의 대상 개통건이 아닙니다. 새로고침 후 확인해주세요.'
      );
    }

    var sh=
      ensureSpotDoneSheet_(ss);

    var key=
      spotDoneKey_(
        spotId,
        month,
        tel
      );

    var row=0;

    if(
      sh.getLastRow()>=2
    ){

      var keys=
        sh.getRange(
          2,
          1,
          sh.getLastRow()-1,
          3
        )
        .getValues();

      for(
        var i=0;
        i<keys.length;
        i++
      ){

        if(
          spotDoneKey_(
            keys[i][0],
            monthKey(keys[i][1]),
            keys[i][2]
          )===key
        ){

          row=i+2;
          break;
        }
      }
    }

    if(!row){

      row=
        sh.getLastRow()+1;
    }

    sh.getRange(
      row,
      2,
      1,
      2
    )
    .setNumberFormat('@');

    sh.getRange(
      row,
      1,
      1,
      SPOT_DONE_HEADERS.length
    )
    .setValues([[
      spotId,
      month,
      tel,
      target.name,
      target.date,
      done,
      Utilities.formatDate(
        new Date(),
        TZ,
        'yyyy-MM-dd HH:mm:ss'
      )
    ]]);

    SpreadsheetApp.flush();

    return{
      saved:true,
      spotId:spotId,
      month:month,
      phone:tel,
      done:done
    };

  }finally{

    lock.releaseLock();
  }
}


/* =========================================================
   리스크관리
========================================================= */

function ensureRiskSheet_(ss){

  var sh=
    ss.getSheetByName(
      '리스크관리'
    );

  if(!sh){

    sh=
      ss.insertSheet(
        '리스크관리'
      );

    sh.getRange(
      1,
      1,
      1,
      RISK_HEADERS.length
    )
    .setValues([
      RISK_HEADERS
    ]);

    sh.setFrozenRows(1);

    return sh;
  }

  var lastColumn=
    Math.max(
      sh.getLastColumn(),
      8
    );

  var headerCount=
    Math.min(
      lastColumn,
      10
    );

  var currentHeaders=
    sh.getRange(
      1,
      1,
      1,
      headerCount
    )
    .getDisplayValues()[0]
    .map(
      function(v){

        return String(
          v||''
        ).trim();
      }
    );

  var isOldRiskStructure=
    norm(currentHeaders[0])===
      norm('등록일시')&&
    norm(currentHeaders[1])===
      norm('적용월')&&
    norm(currentHeaders[2])===
      norm('CTN')&&
    norm(currentHeaders[3])===
      norm('고객명')&&
    norm(currentHeaders[4])===
      norm('카드1')&&
    norm(currentHeaders[5])===
      norm('카드2')&&
    norm(currentHeaders[6])===
      norm('완료')&&
    norm(currentHeaders[7])===
      norm('메모');

  if(isOldRiskStructure){

    var lastRow=
      sh.getLastRow();

    var oldRows=[];

    if(lastRow>=2){

      oldRows=
        sh.getRange(
          2,
          1,
          lastRow-1,
          8
        )
        .getValues();
    }

    if(
      sh.getMaxColumns()<10
    ){

      sh.insertColumnsAfter(
        sh.getMaxColumns(),
        10-
        sh.getMaxColumns()
      );
    }

    sh.getRange(
      1,
      1,
      1,
      10
    )
    .setValues([
      RISK_HEADERS
    ]);

    if(oldRows.length){

      var newRows=
        oldRows.map(
          function(r){

            return[
              r[0],
              r[1],
              r[2],
              r[3],
              '',
              '',
              r[4],
              r[5],
              r[6],
              r[7]
            ];
          }
        );

      sh.getRange(
        2,
        1,
        newRows.length,
        10
      )
      .setValues(
        newRows
      );

      sh.getRange(
        2,
        9,
        newRows.length,
        1
      )
      .insertCheckboxes();

      newRows.forEach(
        function(r,i){

          var done=
            r[8]===true||
            norm(r[8])==='TRUE'||
            norm(r[8])==='O'||
            norm(r[8])==='완료';

          sh.getRange(
            i+2,
            9
          )
          .setValue(done);
        }
      );
    }

    sh.setFrozenRows(1);

    SpreadsheetApp.flush();

    return sh;
  }

  if(
    sh.getMaxColumns()<
    RISK_HEADERS.length
  ){

    sh.insertColumnsAfter(
      sh.getMaxColumns(),
      RISK_HEADERS.length-
      sh.getMaxColumns()
    );
  }

  var current=
    sh.getRange(
      1,
      1,
      1,
      RISK_HEADERS.length
    )
    .getDisplayValues()[0];

  var allBlank=
    current.every(
      function(v){

        return(
          !String(
            v||''
          ).trim()
        );
      }
    );

  if(allBlank){

    sh.getRange(
      1,
      1,
      1,
      RISK_HEADERS.length
    )
    .setValues([
      RISK_HEADERS
    ]);

    sh.setFrozenRows(1);

    return sh;
  }

  for(
    var i=0;
    i<RISK_HEADERS.length;
    i++
  ){

    var cur=
      String(
        current[i]||''
      ).trim();

    if(
      cur&&
      norm(cur)!==
      norm(
        RISK_HEADERS[i]
      )
    ){

      throw new Error(
        '리스크관리 '+
        (i+1)+
        '열 제목이 예상과 다릅니다. 현재 제목: '+
        cur
      );
    }

    if(!cur){

      sh.getRange(
        1,
        i+1
      )
      .setValue(
        RISK_HEADERS[i]
      );
    }
  }

  sh.setFrozenRows(1);

  return sh;
}

function readRiskMap_(
  ss,
  onlyMonth
){

  var sh=
    ensureRiskSheet_(ss);

  var map={};

  if(
    !sh||
    sh.getLastRow()<2
  ){
    return map;
  }

  var rows=
    sh.getRange(
      2,
      1,
      sh.getLastRow()-1,
      RISK_HEADERS.length
    )
    .getValues();

  rows.forEach(
    function(r,idx){

      var mk=
        monthKey(r[1]);

      var tel=
        phone(r[2]);

      if(
        !mk||
        !tel
      ){
        return;
      }

      if(
        onlyMonth&&
        mk!==onlyMonth
      ){
        return;
      }

      map[
        mk+'|'+tel
      ]={

        row:
          idx+2,

        date:
          String(
            r[4]||''
          ).trim(),

        staff:
          String(
            r[5]||''
          ).trim(),

        card1:
          String(
            r[6]||''
          ).trim(),

        card2:
          String(
            r[7]||''
          ).trim(),

        completed:
          r[8]===true||
          norm(r[8])==='TRUE'||
          norm(r[8])==='O'||
          norm(r[8])==='완료',

        memo:
          String(
            r[9]||''
          ).trim()
      };
    }
  );

  return map;
}

function buildRiskRows_(
  ss,
  cases,
  onlyMonth
){

  var map=
    readRiskMap_(
      ss,
      onlyMonth
    );

  return cases
  .filter(
    function(c){

      return(
        Number(c.card||0)>0
      );
    }
  )
  .map(
    function(c){

      var saved=
        map[
          c.month+
          '|'+
          c.phone
        ]||{};

      return{

        key:
          c.month+
          '|'+
          c.phone,

        month:
          c.month,

        sheet:
          c.sheet,

        row:
          c.row,

        no:
          c.no,

        date:
          c.date,

        name:
          c.name,

        phone:
          c.phone,

        staff:
          c.staff,

        card1:
          saved.card1||'',

        card2:
          saved.card2||'',

        completed:
          !!saved.completed,

        memo:
          saved.memo||''
      };
    }
  );
}

function saveRisk(x){

  var lock=
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    if(
      !x||
      !x.month||
      !x.phone
    ){

      throw new Error(
        '저장할 카드 리스크 정보가 없습니다.'
      );
    }

    var ss=
      SpreadsheetApp.openById(
        SPREADSHEET_ID
      );

    var sh=
      ensureRiskSheet_(ss);

    var tel=
      phone(x.phone);

    var mk=
      monthKey(
        x.month
      );

    if(
      !/^20\d{2}-\d{2}$/
      .test(mk)||
      !/^01\d{8,9}$/
      .test(tel)
    ){

      throw new Error(
        '대상 개통건 정보가 올바르지 않습니다.'
      );
    }

    var map=
      readRiskMap_(ss);

    var existing=
      map[
        mk+'|'+tel
      ];

    var row=
      existing
        ?existing.row
        :sh.getLastRow()+1;

    var card1=
      String(
        x.card1||''
      ).trim();

    var card2=
      String(
        x.card2||''
      ).trim();

    var memo=
      String(
        x.memo||''
      ).trim();

    sh.getRange(
      row,
      1,
      1,
      RISK_HEADERS.length
    )
    .setValues([[
      new Date(),
      mk,
      tel,
      String(
        x.name||''
      ).trim(),
      String(
        x.date||''
      ).trim(),
      String(
        x.staff||''
      ).trim(),
      card1,
      card2,
      !!x.completed,
      memo
    ]]);

    sh.getRange(
      row,
      2
    )
    .setNumberFormat('@')
    .setValue(mk);

    sh.getRange(
      row,
      3
    )
    .setNumberFormat('@')
    .setValue(tel);

    sh.getRange(
      row,
      9
    )
    .insertCheckboxes();

    sh.getRange(
      row,
      9
    )
    .setValue(
      !!x.completed
    );

    SpreadsheetApp.flush();

    return{
      saved:true,
      row:row,
      month:mk,
      phone:tel,
      completed:!!x.completed,
      card1:card1,
      card2:card2,
      memo:memo
    };

  }finally{

    lock.releaseLock();
  }
}


/* =========================================================
   대시보드
========================================================= */

function getDashboardData(
  selectedMonth
){

  var ss=
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );

  var monthlySheets=
    getMonthlySheets_(ss);

  var months=
    monthlySheets.map(
      function(info){

        return{
          key:info.key,
          title:info.title
        };
      }
    );

  var month=
    String(
      selectedMonth||''
    ).trim();

  var exists=
    months.some(
      function(m){

        return(
          m.key===month
        );
      }
    );

  if(
    !/^20\d{2}-\d{2}$/
    .test(month)||
    !exists
  ){

    month=
      months.length
        ?months[0].key
        :'';
  }

  var model=
    readCases_(
      ss,
      month
    );

  model.months=
    months;

  var today=
    todayString();

  var spots=
    readSpots_(
      ss,
      model.cases,
      today,
      month
    );

  var risks=
    buildRiskRows_(
      ss,
      model.cases,
      month
    );


  /* ===============================================
     고객혜택 확보금액
     각 개통건의 N열 총 확보금액 합계
  =============================================== */

  var benefitTotal=
    model.cases.reduce(
      function(sum,c){

        return(
          sum+
          (
            Number(
              c.secured
            )||0
          )
        );
      },
      0
    );


  /* ===============================================
     사용금액
     Z열 총 사용금액 전체 합계
  =============================================== */

  var usedTotal=
    model.cases.reduce(
      function(sum,c){

        return(
          sum+
          (
            Number(
              c.totalUsed
            )||0
          )
        );
      },
      0
    );


  /* ===============================================
     스팟 확보금액
     공용재원 스팟에서 별도로 계산
  =============================================== */

  var spotEarned=
    spots.reduce(
      function(sum,s){

        return(
          sum+
          (
            Number(
              s.total
            )||0
          )
        );
      },
      0
    );


  var employees={};

  model.cases.forEach(
    function(c){

      var staff=
        c.staff||
        '미지정';

      if(
        !employees[staff]
      ){

        employees[staff]={

          staff:
            staff,

          post:0,
          mnp:0,
          choice:0,
          house:0,
          second:0,
          card:0
        };
      }

      employees[staff].post+=
        Number(c.post)||0;

      employees[staff].mnp+=
        Number(c.mnp)||0;

      employees[staff].choice+=
        Number(c.choice)||0;

      employees[staff].house+=
        Number(c.house)||0;

      employees[staff].second+=
        Number(c.second)||0;

      employees[staff].card+=
        Number(c.card)||0;
    }
  );

  var employeeStats=
    Object.keys(
      employees
    )
    .map(
      function(k){

        return employees[k];
      }
    )
    .sort(
      function(a,b){

        if(
          b.post!==a.post
        ){

          return(
            b.post-
            a.post
          );
        }

        return a.staff
        .localeCompare(
          b.staff,
          'ko'
        );
      }
    );

  var completedRisk=
    risks.filter(
      function(r){

        return r.completed;
      }
    ).length;

  return{

    selectedMonth:
      month,

    today:
      today,

    months:
      months,

    cases:
      model.cases,

    spots:
      spots,

    risks:
      risks,

    employeeStats:
      employeeStats,

    warnings:
      model.warnings,

    summary:{

      caseCount:
        model.cases.length,


      /*
       * 고객혜택 확보
       * N열 합계
       */

      benefitTotal:
        benefitTotal,


      /*
       * 스팟 확보
       */

      spotEarned:
        spotEarned,


      /*
       * 고객에게 사용한 모든 금액
       * Z 총 사용금액
       */

      usedTotal:
        usedTotal,


      /*
       * 전체 잔여금액
       *
       * 고객혜택 확보
       * +
       * 스팟 확보
       * -
       * 사용금액
       */

      remainingBudget:
        benefitTotal+
        spotEarned-
        usedTotal,


      riskTotal:
        risks.length,

      riskCompleted:
        completedRisk,

      riskIncomplete:
        risks.length-
        completedRisk
    }
  };
}


/* =========================================================
   개통 텍스트 분석
========================================================= */

function parseActivationText(text){

  var raw=
    String(text||'')
    .replace(/\r/g,'')
    .trim();

  if(!raw){

    throw new Error(
      '개통정보를 붙여넣어 주세요.'
    );
  }

  var lines=
    raw
    .split('\n')
    .map(
      function(x){

        return x.trim();
      }
    )
    .filter(Boolean);

  function valueOf(
    labelRegex
  ){

    for(
      var i=0;
      i<lines.length;
      i++
    ){

      var m=
        lines[i]
        .match(
          labelRegex
        );

      if(m){

        return String(
          m[1]||''
        ).trim();
      }
    }

    return '';
  }

  var dateText='';

  for(
    var i=0;
    i<lines.length;
    i++
  ){

    if(
      /^(?:\d{4}[.\/-])?\d{1,2}[.\/-]\d{1,2}$/
      .test(
        lines[i]
      )
    ){

      dateText=
        lines[i];

      break;
    }
  }

  var staff=
    valueOf(
      /^개통자\s*[:：]\s*(.*)$/i
    );

  var name=
    valueOf(
      /^고객명\s*[:：]\s*(.*)$/i
    );

  var tel=
    phone(
      valueOf(
        /^번호\s*[:：]\s*(.*)$/i
      )
    );

  var model=
    normalizeModel(
      valueOf(
        /^모델명\s*[:：]\s*(.*)$/i
      )
    );

  var secondRaw=
    valueOf(
      /^2ND\s*[:：]\s*(.*)$/i
    );

  var specialRaw=
    valueOf(
      /^디초\/가구초\s*[:：]\s*(.*)$/i
    );

  var type=
    valueOf(
      /^유형\s*[:：]\s*(.*)$/i
    );

  var plan=
    valueOf(
      /^요금제\s*[:：]\s*(.*)$/i
    );

  var insurance=
    valueOf(
      /^보험\s*[:：]\s*(.*)$/i
    );

  var addon=
    valueOf(
      /^부가서비스\s*[:：]\s*(.*)$/i
    );

  var card=
    valueOf(
      /^카드\s*[:：]\s*(.*)$/i
    );

  var wired=
    valueOf(
      /^동판\s*[:：]\s*(.*)$/i
    );

  var wiredReason=
    valueOf(
      /^ㄴ\s*불가이유\s*[:：]\s*(.*)$/i
    );

  var policyRaw=
    valueOf(
      /^정책\s*[:：]\s*(.*)$/i
    );

  var benefitRaw=
    valueOf(
      /^ㄴ\s*고혜부분\s*[:：]\s*(.*)$/i
    );

  var budgetRaw=
    valueOf(
      /^ㄴ\s*예산부분\s*[:：]\s*(.*)$/i
    );

  var usedRaw=
    valueOf(
      /^정책처리내용\s*[:：]\s*(.*)$/i
    );

  var device1=
    valueOf(
      /^ㄴ\s*\(추지\)기기값\s*[:：]\s*(.*)$/i
    );

  var device2=
    valueOf(
      /^ㄴ\s*\(GB\)기기값\s*[:：]\s*(.*)$/i
    );

  var rateNote=
    valueOf(
      /^ㄴ\s*요금\s*[:：]\s*(.*)$/i
    );

  var usedPhone=
    valueOf(
      /^중고폰\s*[:：]\s*(.*)$/i
    );

  if(!dateText){

    throw new Error(
      '개통일을 찾지 못했습니다.'
    );
  }

  if(!staff){

    throw new Error(
      '개통자를 입력해주세요.'
    );
  }

  if(!name){

    throw new Error(
      '고객명을 입력해주세요.'
    );
  }

  if(
    !/^01\d{8,9}$/
    .test(tel)
  ){

    throw new Error(
      '휴대폰 번호를 확인해주세요.'
    );
  }

  if(!model){

    throw new Error(
      '모델명을 입력해주세요.'
    );
  }

  if(!type){

    throw new Error(
      '유형을 입력해주세요.'
    );
  }

  if(!plan){

    throw new Error(
      '요금제를 입력해주세요.'
    );
  }

  var year=
    todayString()
    .slice(0,4);

  var mm;
  var dd;

  var dm=
    dateText.match(
      /^(\d{1,2})[.\/-](\d{1,2})$/
    );

  if(dm){

    mm=
      String(
        Number(dm[1])
      ).padStart(2,'0');

    dd=
      String(
        Number(dm[2])
      ).padStart(2,'0');

  }else{

    dm=
      dateText.match(
        /^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/
      );

    if(!dm){

      throw new Error(
        '개통일 형식을 확인해주세요.'
      );
    }

    year=
      dm[1];

    mm=
      String(
        Number(dm[2])
      ).padStart(2,'0');

    dd=
      String(
        Number(dm[3])
      ).padStart(2,'0');
  }

  var fullDate=
    year+
    '-'+mm+
    '-'+dd;

  if(
    !validDate(
      fullDate
    )
  ){

    throw new Error(
      '개통일을 확인해주세요.'
    );
  }

  var mk=
    year+
    '-'+mm;

  var warnings=[];

  var used=
    amount(
      usedRaw||0
    );

  if(rateNote){

    var rateMatch=
      rateNote.match(
        /(\d+)\s*개월.*?매달\s*([\d,]+)\s*원/
      );

    if(rateMatch){

      var calc=
        Number(
          rateMatch[1]
        )*
        Number(
          rateMatch[2]
          .replace(
            /,/g,
            ''
          )
        );

      if(
        used>0&&
        calc!==used
      ){

        warnings.push(
          '정책처리내용 '+
          used.toLocaleString(
            'ko-KR'
          )+
          '원 / 요금 설명 계산 '+
          calc.toLocaleString(
            'ko-KR'
          )+
          '원으로 금액이 다릅니다.'
        );
      }
    }
  }

  return{

    month:
      mk,

    date:
      fullDate,

    dateDisplay:
      Number(mm)+
      '월 '+
      Number(dd)+
      '일',

    staff:
      staff,

    name:
      name,

    phone:
      tel,

    model:
      model,

    type:
      type,

    plan:
      plan,

    second:
      secondRaw||'X',

    special:
      specialRaw||'X',

    insurance:
      insurance||'X',

    addon:
      addon||'X',

    card:
      card||'X',

    wired:
      wired||'X',

    wiredReason:
      wiredReason,

    policy:
      policyAmount(
        policyRaw
      ),

    benefit:
      policyAmount(
        benefitRaw
      ),

    budget:
      policyAmount(
        budgetRaw
      ),

    used:
      used,

    useDevice:
      amount(
        device1||0
      ),

    useGbDevice:
      amount(
        device2||0
      ),

    rateNote:
      rateNote,

    usedPhone:
      usedPhone||'X',

    warnings:
      warnings
  };
}


/* =========================================================
   개통 저장
   기본 개통정보
   C No. / D 개통일 / E 고객 / F CTN
   G 종류 / H 모델명 / J 요금제 / M 직원명
   + 기존대로 AL 카드 / AM 카드사 / AO 보험 / AP 부가 / AR 동판

   A 검수완료, B 메모, N 총 확보금액부터
   고객혜택·사용금액 등 예산 영역은 값/수식/서식 모두 건드리지 않음
========================================================= */

function saveActivationText(text){

  var lock=
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    var x=
      parseActivationText(
        text
      );

    var ss=
      SpreadsheetApp.openById(
        SPREADSHEET_ID
      );

    var target=
      getMonthlySheets_(ss)
      .find(
        function(info){

          return(
            info.key===
            x.month
          );
        }
      );

    if(!target){

      throw new Error(
        displayMonthKey(
          x.month
        )+
        ' 시트를 찾지 못했습니다.'
      );
    }

    var sh=
      target.sh;

    var headerProblems=
      checkCaseHeaders_(sh);

    if(headerProblems.length){

      throw new Error(
        target.title+
        ' 장표 헤더가 예상과 다릅니다. 저장하지 않았습니다. ('+
        headerProblems.join(', ')+
        ')'
      );
    }

    var lastRow=
      Math.max(
        sh.getLastRow(),
        10
      );

    var existing=
      sh.getRange(
        10,
        6,
        lastRow-9,
        1
      )
      .getValues();

    for(
      var i=0;
      i<existing.length;
      i++
    ){

      if(
        phone(
          existing[i][0]
        )===
        x.phone
      ){

        throw new Error(
          '같은 번호가 이미 '+
          (i+10)+
          '행에 있습니다.'
        );
      }
    }

    var row=10;

    while(
      row<=
      sh.getMaxRows()
    ){

      if(
        !sh.getRange(
          row,
          5
        ).getValue()&&
        !sh.getRange(
          row,
          6
        ).getValue()
      ){

        break;
      }

      row++;
    }

    if(
      row>
      sh.getMaxRows()
    ){

      sh.insertRowsAfter(
        sh.getMaxRows(),
        20
      );
    }

    var noCell=
      sh.getRange(
        row,
        3
      );

    var no=
      Number(
        noCell.getValue()
      )||0;

    if(!no){

      var maxNo=0;

      if(row>10){

        sh.getRange(
          10,
          3,
          row-10,
          1
        )
        .getValues()
        .forEach(
          function(v){

            maxNo=
              Math.max(
                maxNo,
                Number(v[0])||0
              );
          }
        );
      }

      no=
        maxNo+1;

      noCell.setValue(no);
    }


    /*
     * 기본 개통정보 입력
     * A/B 및 N~ 예산 영역은 쓰지 않음
     */

    sh.getRange(
      row,
      4
    )
    .setValue(
      x.dateDisplay
    );

    sh.getRange(
      row,
      5
    )
    .setValue(
      x.name
    );

    sh.getRange(
      row,
      6
    )
    .setNumberFormat('@')
    .setValue(
      x.phone
    );

    sh.getRange(
      row,
      7
    )
    .setValue(
      x.type
    );

    sh.getRange(
      row,
      8
    )
    .setValue(
      x.model
    );

    sh.getRange(
      row,
      10
    )
    .setValue(
      x.plan
    );

    sh.getRange(
      row,
      13
    )
    .setValue(
      x.staff
    );


    /*
     * 카드/보험/부가/유선 (기존 저장 로직 유지)
     * AL 카드 여부 → 리스크관리·직원별 카드 실적에 사용
     * AM 카드사 / AO 보험 / AP 부가서비스 / AR 동판
     */

    if(
      x.card&&
      norm(x.card)!=='X'
    ){

      sh.getRange(
        row,
        38
      )
      .setValue(1);

      sh.getRange(
        row,
        39
      )
      .setValue(
        x.card
      );
    }

    sh.getRange(
      row,
      41
    )
    .setValue(
      norm(
        x.insurance
      )==='X'
        ?'X'
        :'O'
    );

    sh.getRange(
      row,
      42
    )
    .setValue(
      norm(
        x.addon
      )==='X'
        ?'X'
        :'O'
    );

    sh.getRange(
      row,
      44
    )
    .setValue(
      norm(
        x.wired
      )==='X'
        ?'X'
        :x.wired
    );

    SpreadsheetApp.flush();

    return{

      saved:true,

      sheet:
        sh.getName(),

      row:
        row,

      no:
        no,

      data:
        x
    };

  }finally{

    lock.releaseLock();
  }
}