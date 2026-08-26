#property copyright "Deriv AI Trader"
#property version   "0.30"
#property strict
#property description "EA bridge for Deriv V25/V100 - demo validation only"

#include <Trade/Trade.mqh>
CTrade trade;

input string ApiBaseUrl = "https://deriv-ai-trader.javakikso.chatgpt.site";
input string ApiKey = "PASTE_YOUR_EA_API_KEY";
input double MaxRiskUsd = 10.0;
input double RewardRiskRatio = 2.0;
input int AtrPeriod = 14;
input double AtrStopMultiplier = 1.5;
input int PollSeconds = 15;
input long MagicNumber = 251003;
input bool AllowAutoExecution = false;

datetime lastM5Bar = 0;
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

void ExecuteDecision(string action,double atr) {
  if(!AllowAutoExecution || PositionSelect(_Symbol) || atr<=0) return;
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
  string payload="{\"symbol\":\""+_Symbol+"\",\"timeframe\":\"M5\",\"proposedRiskUsd\":"+DoubleToString(MaxRiskUsd,2)+",\"accountType\":\"demo\",\"openPositions\":"+(PositionSelect(_Symbol)?"1":"0")+",\"smc\":{\"htfBias\":\""+bias+"\",\"bos\":"+JsonBool(bos)+",\"choch\":false,\"liquiditySweep\":"+JsonBool(sweep)+",\"orderBlock\":false,\"fairValueGap\":"+JsonBool(fvg)+",\"premiumDiscountAligned\":"+JsonBool(bos)+",\"ltfConfirmation\":"+JsonBool(confirm)+"},\"ml\":{\"confidence\":"+DoubleToString(confidence,2)+",\"direction\":\""+direction+"\"}}";
  string action="NO_TRADE"; int score=0;
  if(ApiAnalyze(payload,action,score)) { Print("Decision ",action," score=",score); ExecuteDecision(action,GetAtr()); }
}

int OnInit() {
  if(!IsSupportedSymbol()) return INIT_PARAMETERS_INCORRECT;
  if(ApiKey=="PASTE_YOUR_EA_API_KEY") Print("Configure ApiKey before use");
  atrHandle=iATR(_Symbol,PERIOD_M15,AtrPeriod); if(atrHandle==INVALID_HANDLE) return INIT_FAILED;
  EventSetTimer(MathMax(5,PollSeconds)); Print("Deriv AI Trader EA v0.30 initialized on ",_Symbol); return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); if(atrHandle!=INVALID_HANDLE) IndicatorRelease(atrHandle); }
void OnTimer() { if(HasNewM5Bar()) AnalyzeMarket(); }
