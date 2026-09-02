#property copyright "Deriv AI Trader"
#property version   "0.36"
#property strict
#property description "EA bridge for Deriv V25/V100 - demo or explicit real trading"

#include <Trade/Trade.mqh>
CTrade trade;

input string ApiBaseUrl = "https://deriv-ai-trader.javakikso.chatgpt.site";
input string ApiKey = "PASTE_YOUR_EA_API_KEY";
input double MaxRiskUsd = 10.0;
input double RewardRiskRatio = 2.0;
input int AtrPeriod = 14;
input double AtrStopMultiplier = 1.5;
input int PollSeconds = 1;
input int LiveUpdateMs = 250;
input long MagicNumber = 251003;
input bool AllowAutoExecution = false;
input bool AllowDashboardCommands = true;
input bool AllowRealTrading = false;

datetime lastM5Bar = 0;
datetime lastHeartbeat = 0;
datetime lastCommandPoll = 0;
uint lastHeartbeatMs = 0;
double lastSentPrice = 0;
int atrHandle = INVALID_HANDLE;

bool IsSupportedSymbol() {
  return StringFind(_Symbol,"Volatility 25") >= 0 || StringFind(_Symbol,"Volatility 100") >= 0;
}

string JsonBool(bool value) { return value ? "true" : "false"; }

bool HasNewM5Bar() {
  datetime current = iTime(_Symbol,PERIOD_M5,0);
  if(current == 0 || current == lastM5Bar) return false;
  lastM5Bar = current;
  return true;
}

double GetAtr() {
  double buffer[1];
  if(atrHandle == INVALID_HANDLE || CopyBuffer(atrHandle,0,1,1,buffer) != 1) return 0;
  return buffer[0];
}

double H1Mean(int periods=50) {
  double total=0; for(int i=1;i<=periods;i++) total+=iClose(_Symbol,PERIOD_H1,i);
  return total/periods;
}
bool BullishBias() { return iClose(_Symbol,PERIOD_H1,1) > H1Mean(); }
bool BearishBias() { return iClose(_Symbol,PERIOD_H1,1) < H1Mean(); }

bool BullishBos() {
  return iClose(_Symbol,PERIOD_M15,1) > iHigh(_Symbol,PERIOD_M15,2) && iHigh(_Symbol,PERIOD_M15,2) > iHigh(_Symbol,PERIOD_M15,3);
}
bool BearishBos() {
  return iClose(_Symbol,PERIOD_M15,1) < iLow(_Symbol,PERIOD_M15,2) && iLow(_Symbol,PERIOD_M15,2) < iLow(_Symbol,PERIOD_M15,3);
}
bool LiquiditySweep(bool bullish) {
  if(bullish) return iLow(_Symbol,PERIOD_M15,1) < iLow(_Symbol,PERIOD_M15,2) && iClose(_Symbol,PERIOD_M15,1) > iLow(_Symbol,PERIOD_M15,2);
  return iHigh(_Symbol,PERIOD_M15,1) > iHigh(_Symbol,PERIOD_M15,2) && iClose(_Symbol,PERIOD_M15,1) < iHigh(_Symbol,PERIOD_M15,2);
}
bool FairValueGap(bool bullish) {
  if(bullish) return iLow(_Symbol,PERIOD_M5,1) > iHigh(_Symbol,PERIOD_M5,3);
  return iHigh(_Symbol,PERIOD_M5,1) < iLow(_Symbol,PERIOD_M5,3);
}
bool LtfConfirmation(bool bullish) {
  double open=iOpen(_Symbol,PERIOD_M5,1), close=iClose(_Symbol,PERIOD_M5,1);
  return bullish ? close>open : close<open;
}

double NormalizeVolume(double volume) {
  double minLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN), maxLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX), step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
  volume=MathMax(minLot,MathMin(maxLot,volume));
  return NormalizeDouble(MathFloor(volume/step)*step,2);
}

double LotForRisk(double stopDistance) {
  double tickSize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE), tickValue=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
  if(tickSize<=0 || tickValue<=0 || stopDistance<=0) return 0;
  return NormalizeVolume(MaxRiskUsd / ((stopDistance/tickSize)*tickValue));
}

string FindJsonString(string json,string key) {
  string needle="\""+key+"\":\""; int start=StringFind(json,needle);
  if(start<0) return ""; start+=StringLen(needle); int finish=StringFind(json,"\"",start);
  return finish>start ? StringSubstr(json,start,finish-start) : "";
}

int FindJsonInt(string json,string key) {
  string needle="\""+key+"\":"; int start=StringFind(json,needle);
  if(start<0) return 0; start+=StringLen(needle); return (int)StringToInteger(StringSubstr(json,start,4));
}

double FindJsonDouble(string json,string key) {
  string needle="\""+key+"\":"; int start=StringFind(json,needle);
  if(start<0) return 0; start+=StringLen(needle); return StringToDouble(StringSubstr(json,start,16));
}

bool ApiAnalyze(string payload,string &action,int &score) {
  char body[],response[]; string responseHeaders;
  StringToCharArray(payload,body,0,WHOLE_ARRAY,CP_UTF8); ArrayResize(body,ArraySize(body)-1);
  string headers="Content-Type: application/json\r\nX-EA-API-Key: "+ApiKey+"\r\n";
  ResetLastError();
  int code=WebRequest("POST",ApiBaseUrl+"/api/trading/analyze",headers,8000,body,response,responseHeaders);
  if(code!=200) { Print("API error HTTP=",code," MT5=",GetLastError()," response=",CharArrayToString(response)); return false; }
  string json=CharArrayToString(response,0,-1,CP_UTF8);
  action=FindJsonString(json,"action"); score=FindJsonInt(json,"score");
  return action!="";
}

string PositionsJson() {
  string json="[";
  int count=0;
  for(int i=0;i<PositionsTotal();i++) {
    ulong ticket=PositionGetTicket(i);
    if(ticket==0) continue;
    string symbol=PositionGetString(POSITION_SYMBOL);
    long type=PositionGetInteger(POSITION_TYPE);
    if(count>0) json+=",";
    json+="{\"ticket\":"+IntegerToString((long)ticket)+",\"symbol\":\""+symbol+"\",\"type\":\""+(type==POSITION_TYPE_BUY?"BUY":"SELL")+"\",\"volume\":"+DoubleToString(PositionGetDouble(POSITION_VOLUME),2)+",\"priceOpen\":"+DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN),(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS))+",\"profit\":"+DoubleToString(PositionGetDouble(POSITION_PROFIT),2)+"}";
    count++;
  }
  json+="]";
  return json;
}

bool ApiHeartbeat() {
  lastHeartbeat=TimeCurrent();
  lastHeartbeatMs=GetTickCount();
  MqlTick tick;
  double bid=0, ask=0, last=0;
  if(SymbolInfoTick(_Symbol,tick)) { bid=tick.bid; ask=tick.ask; last=tick.last>0 ? tick.last : tick.bid; }
  lastSentPrice=last;
  int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
  string payload="{\"source\":\"mt5-ea\",\"version\":\"0.36\",\"symbol\":\""+_Symbol+"\",\"account\":"+IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN))+",\"currency\":\""+AccountInfoString(ACCOUNT_CURRENCY)+"\",\"balance\":"+DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),2)+",\"equity\":"+DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),2)+",\"profit\":"+DoubleToString(AccountInfoDouble(ACCOUNT_PROFIT),2)+",\"bid\":"+DoubleToString(bid,digits)+",\"ask\":"+DoubleToString(ask,digits)+",\"last\":"+DoubleToString(last,digits)+",\"demo\":"+JsonBool(AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO)+",\"positions\":"+PositionsJson()+"}";
  char body[],response[]; string responseHeaders;
  StringToCharArray(payload,body,0,WHOLE_ARRAY,CP_UTF8); ArrayResize(body,ArraySize(body)-1);
  string headers="Content-Type: application/json\r\nX-EA-API-Key: "+ApiKey+"\r\n";
  ResetLastError();
  int code=WebRequest("POST",ApiBaseUrl+"/api/mt5/heartbeat",headers,8000,body,response,responseHeaders);
  if(code!=200) { Print("Heartbeat error HTTP=",code," MT5=",GetLastError()," response=",CharArrayToString(response)); return false; }
  return true;
}

void SendLiveHeartbeat() {
  MqlTick tick;
  if(!SymbolInfoTick(_Symbol,tick)) return;
  double last=tick.last>0 ? tick.last : tick.bid;
  uint nowMs=GetTickCount();
  if(last==lastSentPrice && nowMs-lastHeartbeatMs < (uint)MathMax(250,LiveUpdateMs)) return;
  if(nowMs-lastHeartbeatMs < (uint)MathMax(100,LiveUpdateMs)) return;
  ApiHeartbeat();
}

void ExecuteManualCommand(string action,double volume,string commandId,string requestedAccountMode) {
  if(!AllowDashboardCommands) { Print("Dashboard command ignored: disabled"); return; }
  bool isDemo = AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO;
  string connectedMode = isDemo ? "demo" : "real";
  if(requestedAccountMode!="" && requestedAccountMode!=connectedMode) { Print("Dashboard command refused: account mode mismatch ",requestedAccountMode," vs ",connectedMode); return; }
  if(!isDemo && !AllowRealTrading) { Print("Dashboard command refused: real trading disabled"); return; }
  if(PositionSelect(_Symbol)) { Print("Dashboard command refused: position already open on ",_Symbol); return; }
  MqlTick tick; if(!SymbolInfoTick(_Symbol,tick)) { Print("Dashboard command refused: no tick"); return; }
  double lot=NormalizeVolume(volume);
  if(lot<=0) { Print("Dashboard command refused: invalid lot ",volume); return; }

  trade.SetExpertMagicNumber(MagicNumber);
  trade.SetDeviationInPoints(30);
  if(action=="SELL") {
    if(trade.Sell(lot,_Symbol,tick.bid,0,0,"Dashboard SELL "+commandId)) Print("Dashboard SELL executed lot=",lot);
    else Print("Dashboard SELL rejected: ",trade.ResultRetcodeDescription());
  } else if(action=="BUY") {
    if(trade.Buy(lot,_Symbol,tick.ask,0,0,"Dashboard BUY "+commandId)) Print("Dashboard BUY executed lot=",lot);
    else Print("Dashboard BUY rejected: ",trade.ResultRetcodeDescription());
  }
}

bool ApiManualCommand() {
  lastCommandPoll=TimeCurrent();
  char body[],response[]; string responseHeaders;
  ArrayResize(body,0);
  string headers="X-EA-API-Key: "+ApiKey+"\r\n";
  ResetLastError();
  int code=WebRequest("GET",ApiBaseUrl+"/api/mt5/command",headers,8000,body,response,responseHeaders);
  if(code!=200) { Print("Command poll error HTTP=",code," MT5=",GetLastError()," response=",CharArrayToString(response)); return false; }

  string json=CharArrayToString(response,0,-1,CP_UTF8);
  string action=FindJsonString(json,"action");
  if(action=="") return true;

  string commandSymbol=FindJsonString(json,"symbol");
  if(commandSymbol!="" && StringFind(_Symbol,commandSymbol)<0 && StringFind(commandSymbol,_Symbol)<0) {
    Print("Dashboard command ignored: symbol mismatch ",commandSymbol," vs ",_Symbol);
    return true;
  }

  ExecuteManualCommand(action,FindJsonDouble(json,"volume"),FindJsonString(json,"id"),FindJsonString(json,"accountMode"));
  return true;
}

void ExecuteDecision(string action,double atr) {
  if(!AllowAutoExecution || PositionSelect(_Symbol) || atr<=0) return;
  if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO && !AllowRealTrading) { Print("Auto execution refused: real trading disabled"); return; }
  MqlTick tick; if(!SymbolInfoTick(_Symbol,tick)) return;
  double stopDistance=atr*AtrStopMultiplier, lot=LotForRisk(stopDistance);
  if(lot<=0) { Print("Lot calculation failed"); return; }
  int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
  trade.SetExpertMagicNumber(MagicNumber); trade.SetDeviationInPoints(30);
  if(action=="BUY") {
    double sl=NormalizeDouble(tick.ask-stopDistance,digits), tp=NormalizeDouble(tick.ask+stopDistance*RewardRiskRatio,digits);
    if(!trade.Buy(lot,_Symbol,tick.ask,sl,tp,"AI-SMC BUY")) Print("BUY rejected: ",trade.ResultRetcodeDescription());
  } else if(action=="SELL") {
    double sl=NormalizeDouble(tick.bid+stopDistance,digits), tp=NormalizeDouble(tick.bid-stopDistance*RewardRiskRatio,digits);
    if(!trade.Sell(lot,_Symbol,tick.bid,sl,tp,"AI-SMC SELL")) Print("SELL rejected: ",trade.ResultRetcodeDescription());
  }
}

void AnalyzeMarket() {
  if(!IsSupportedSymbol()) { Print("Unsupported symbol: ",_Symbol); return; }
  bool bullish=BullishBias(), bearish=BearishBias(), bos=bullish?BullishBos():BearishBos();
  string bias=bullish?"bullish":bearish?"bearish":"neutral";
  string direction=bullish?"buy":bearish?"sell":"none";
  bool sweep=LiquiditySweep(bullish), fvg=FairValueGap(bullish), confirm=LtfConfirmation(bullish);
  double confidence=(bos&&sweep&&confirm)?0.84:0.62;
  MqlTick tick;
  double last=SymbolInfoTick(_Symbol,tick) ? (tick.last>0 ? tick.last : tick.bid) : iClose(_Symbol,PERIOD_M5,1);
  int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
  string accountType = AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO ? "demo" : "real";
  string payload="{\"symbol\":\""+_Symbol+"\",\"timeframe\":\"M5\",\"price\":"+DoubleToString(last,digits)+",\"proposedRiskUsd\":"+DoubleToString(MaxRiskUsd,2)+",\"accountType\":\""+accountType+"\",\"openPositions\":"+(PositionSelect(_Symbol)?"1":"0")+",\"smc\":{\"htfBias\":\""+bias+"\",\"bos\":"+JsonBool(bos)+",\"choch\":false,\"liquiditySweep\":"+JsonBool(sweep)+",\"orderBlock\":false,\"fairValueGap\":"+JsonBool(fvg)+",\"premiumDiscountAligned\":"+JsonBool(bos)+",\"ltfConfirmation\":"+JsonBool(confirm)+"},\"ml\":{\"confidence\":"+DoubleToString(confidence,2)+",\"direction\":\""+direction+"\"}}";
  string action="NO_TRADE"; int score=0;
  if(ApiAnalyze(payload,action,score)) { Print("Decision ",action," score=",score); ExecuteDecision(action,GetAtr()); }
}

int OnInit() {
  if(!IsSupportedSymbol()) return INIT_PARAMETERS_INCORRECT;
  if(ApiKey=="PASTE_YOUR_EA_API_KEY") Print("Configure ApiKey before use");
  atrHandle=iATR(_Symbol,PERIOD_M15,AtrPeriod); if(atrHandle==INVALID_HANDLE) return INIT_FAILED;
  EventSetMillisecondTimer(MathMax(250,LiveUpdateMs));
  Print("Deriv AI Trader EA v0.36 initialized on ",_Symbol," API=",ApiBaseUrl);
  ApiHeartbeat();
  return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); if(atrHandle!=INVALID_HANDLE) IndicatorRelease(atrHandle); }
void OnTick() { SendLiveHeartbeat(); }
void OnTimer() {
  SendLiveHeartbeat();
  if(TimeCurrent()!=lastCommandPoll) ApiManualCommand();
  if(HasNewM5Bar()) AnalyzeMarket();
}
