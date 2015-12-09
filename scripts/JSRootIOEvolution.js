/// @file JSRootIOEvolution.js
/// I/O methods of JavaScript ROOT

(function( factory ) {
   if ( typeof define === "function" && define.amd ) {
      // AMD. Register as an anonymous module.
      define( ['JSRootCore', 'rawinflate'], factory );
   } else {
      if (typeof JSROOT == 'undefined')
         throw new Error("This extension requires JSRootCore.js", "JSRootIOEvolution.js");

      if (typeof JSROOT.IO == "object")
         throw new Error("This JSROOT IO already loaded", "JSRootIOEvolution.js");

      factory(JSROOT);
   }
} (function(JSROOT) {

   JSROOT.IO = {
         kBase : 0, kOffsetL : 20, kOffsetP : 40, kCounter : 6, kCharStar : 7,
         kChar : 1, kShort : 2, kInt : 3, kLong : 4, kFloat : 5,
         kDouble : 8, kDouble32 : 9, kLegacyChar : 10, kUChar : 11, kUShort : 12,
         kUInt : 13, kULong : 14, kBits : 15, kLong64 : 16, kULong64 : 17, kBool : 18,
         kFloat16 : 19,
         kObject : 61, kAny : 62, kObjectp : 63, kObjectP : 64, kTString : 65,
         kTObject : 66, kTNamed : 67, kAnyp : 68, kAnyP : 69, kAnyPnoVT : 70,
         kSTLp : 71,
         kSkip : 100, kSkipL : 120, kSkipP : 140,
         kConv : 200, kConvL : 220, kConvP : 240,
         kSTL : 300, kSTLstring : 365,
         kStreamer : 500, kStreamLoop : 501,
         kMapOffset : 2,
         kByteCountMask : 0x40000000,
         kNewClassTag : 0xFFFFFFFF,
         kClassMask : 0x80000000,
         Z_DEFLATED : 8,
         Z_HDRSIZE : 9,
         Mode : "array", // could be string or array, enable usage of ArrayBuffer in http requests
         NativeArray : true // when true, native arrays like Int32Array or Float64Array are used
   };

   JSROOT.fUserStreamers = null; // map of user-streamer function like func(buf,obj,prop,streamerinfo)

   JSROOT.addUserStreamer = function(type, user_streamer) {
      if (JSROOT.fUserStreamers == null) JSROOT.fUserStreamers = {};
      JSROOT.fUserStreamers[type] = user_streamer;
   }

   JSROOT.R__unzip = function(str, tgtsize, noalert) {
      // Reads header envelope, determines zipped size and unzip content

      var isarr = (typeof str != 'string') && ('byteLength' in str);

      var len = isarr ? str.byteLength : str.length;

      function getChar(o) {
         return isarr ? String.fromCharCode(str.getUint8(o)) : str.charAt(o);
      }

      function getCode(o) {
         return isarr ? str.getUint8(o) : str.charCodeAt(o);
      }

      if (JSROOT.IO.Z_HDRSIZE > len) {
         if (!noalert) alert("Error R__unzip: header size exceeds buffer size");
         return null;
      }

      /*   C H E C K   H E A D E R   */
      if (!(getChar(0) == 'Z' && getChar(1) == 'L' && getCode(2) == JSROOT.IO.Z_DEFLATED) &&
          !(getChar(0) == 'C' && getChar(1) == 'S' && getCode(2) == JSROOT.IO.Z_DEFLATED) &&
          !(getChar(0) == 'X' && getChar(1) == 'Z' && getCode(2) == 0)) {
         if (!noalert) alert("Error R__unzip: error in header");
         return null;
      }

      if (getChar(0) != 'Z' && getCharAt(1) != 'L') {
         if (!noalert) alert("R__unzip: Old zlib format is not supported!");
         return null;
      }

      var srcsize = JSROOT.IO.Z_HDRSIZE +
                      ((getCode(3) & 0xff) | ((getCode(4) & 0xff) << 8) | ((getCode(5) & 0xff) << 16));

      if (!isarr)
         return window.RawInflate.inflate(str.substr(JSROOT.IO.Z_HDRSIZE + 2, srcsize));

      var uint8arr = new Uint8Array(str.buffer, str.byteOffset + JSROOT.IO.Z_HDRSIZE + 2, str.byteLength - JSROOT.IO.Z_HDRSIZE - 2);

      var tgtbuf = new ArrayBuffer(tgtsize);

      var res = window.RawInflate.arr_inflate(uint8arr, new Uint8Array(tgtbuf));

      if (res != tgtsize) {
         if (!noalert) alert("R__unzip: mismatch between unpacked size and keys info " + res + " - " + tgtsize);
         return null;
      }

      return new DataView(tgtbuf);
   }

   // =================================================================================

   JSROOT.TBuffer = function(_o, _file) {
      this._typename = "TBuffer";
      this.o = (_o==null) ? 0 : _o;
      this.fFile = _file;
      this.ClearObjectMap();
      this.fTagOffset = 0;
      this.progress = false;
      return this;
   }

   JSROOT.TBuffer.prototype.locate = function(pos) {
      this.o = pos;
   }

   JSROOT.TBuffer.prototype.shift = function(cnt) {
      this.o += cnt;
   }

   JSROOT.TBuffer.prototype.EnableProgress = function() {
      // JSROOT.progress(0.);

      if (this.totalLength() < 1e4) return;

      this.progress = true;

      var step = this.totalLength() / 20;
      if (step > 1e5) step = 1e5; else
      if (step < 1e3) step = 1e3;
      this.progress_limit = step;
   }

   JSROOT.TBuffer.prototype.CheckProgress = function() {
      if (this.o < this.progress_limit) return;

      // JSROOT.progress(this.o/this.totalLength());

      var step = this.totalLength() / 20;
      if (step > 1e5) step = 1e5; else
      if (step < 1e3) step = 1e3;
      this.progress_limit+=step;
   }

   JSROOT.TBuffer.prototype.GetMappedObject = function(tag) {
      return this.fObjectMap[tag];
   }

   JSROOT.TBuffer.prototype.MapObject = function(tag, obj) {
      if (obj==null) return;
      this.fObjectMap[tag] = obj;
   }

   JSROOT.TBuffer.prototype.MapClass = function(tag, classname) {
      this.fClassMap[tag] = classname;
   }

   JSROOT.TBuffer.prototype.GetMappedClass = function(tag) {
      if (tag in this.fClassMap) return this.fClassMap[tag];
      return -1;
   }

   JSROOT.TBuffer.prototype.ClearObjectMap = function() {
      this.fObjectMap = {};
      this.fClassMap = {};
      this.fObjectMap[0] = null;
   }

   JSROOT.TBuffer.prototype.ReadVersion = function() {
      // read class version from I/O buffer
      var ver = {};
      var bytecnt = this.ntou4(); // byte count
      if (bytecnt & JSROOT.IO.kByteCountMask)
         ver['bytecnt'] = bytecnt - JSROOT.IO.kByteCountMask - 2; // one can check between Read version and end of streamer
      else
         this.o -= 4; // rollback read bytes, this is old buffer without bytecount
      ver['val'] = this.ntou2();
      ver['off'] = this.o;
      return ver;
   }

   JSROOT.TBuffer.prototype.CheckBytecount = function(ver, where) {
      if (('bytecnt' in ver) && (ver['off'] + ver['bytecnt'] != this.o)) {
         if (where!=null)
            alert("Missmatch in " + where + " bytecount expected = " + ver['bytecnt'] + "  got = " + (this.o-ver['off']));
         this.o = ver['off'] + ver['bytecnt'];
         return false;
      }
      return true;
   }

   JSROOT.TBuffer.prototype.ReadString = function() {
      // read a null-terminated string from buffer
      var pos0 = this.o, len = this.totalLength();
      while (this.o < len) {
         if (this.codeAt(this.o++) == 0) break;
      }
      return (this.o > pos0) ? this.substring(pos0, this.o-1) : "";
   }

   JSROOT.TBuffer.prototype.ReadTString = function() {
      // stream a TString object from buffer
      var len = this.ntou1();
      // large strings
      if (len == 255) len = this.ntou4();
      if (len==0) return "";

      var pos = this.o;
      this.o += len;

      return (this.codeAt(pos) == 0) ? '' : this.substring(pos, pos + len);
   }

   JSROOT.TBuffer.prototype.ReadFastArray = function(n, array_type) {
      // read array of n values from the I/O buffer

      var array = null;
      switch (array_type) {
         case JSROOT.IO.kDouble:
            array = JSROOT.IO.NativeArray ? new Float64Array(n) : new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntod();
            break;
         case JSROOT.IO.kFloat:
            array = JSROOT.IO.NativeArray ? new Float32Array(n) : new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntof();
            break;
         case JSROOT.IO.kLong64:
            array = JSROOT.IO.NativeArray ? new Float64Array(n) : new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntoi8();
            break;
         case JSROOT.IO.kULong64:
            array = JSROOT.IO.NativeArray ? new Float64Array(n) : new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntou8();
            break;
         case JSROOT.IO.kInt:
            array = JSROOT.IO.NativeArray ? new Int32Array(n) : new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntoi4();
            break;
         case JSROOT.IO.kUInt:
            array = JSROOT.IO.NativeArray ? new Uint32Array(n) : new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntou4();
            break;
         case JSROOT.IO.kShort:
            array = JSROOT.IO.NativeArray ? new Int16Array(n) : new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntoi2();
            break;
         case JSROOT.IO.kUShort:
            array = JSROOT.IO.NativeArray ? new Uint16Array(n) : new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntou2();
            break;
         case JSROOT.IO.kChar:
            array = JSROOT.IO.NativeArray ? new Int8Array(n) : new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntoi1();
            break;
         case JSROOT.IO.kUChar:
            array = JSROOT.IO.NativeArray ? new Uint8Array(n) : new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntoi1();
            break;
         case JSROOT.IO.kTString:
            array = new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ReadTString();
            break;
         default:
            array = new Array(n);
            for (var i = 0; i < n; ++i)
               array[i] = this.ntou4();
         break;
      }
      return array;
   }

   JSROOT.TBuffer.prototype.ReadTArray = function(type_name, n) {
      var array_type = JSROOT.IO.kInt;
      switch (type_name.charAt(6)) {
         case 'I' : array_type = JSROOT.IO.kInt; break;
         case 'D' : array_type = JSROOT.IO.kDouble; break;
         case 'F' : array_type = JSROOT.IO.kFloat; break;
         case 'S' : array_type = JSROOT.IO.kShort; break;
         case 'C' : array_type = JSROOT.IO.kChar; break;
         case 'L' : array_type = JSROOT.IO.kLong; break;
         default: alert('unsupported array type ' + type_name); break;
      }
      return this.ReadFastArray(n, array_type);
   }

   JSROOT.TBuffer.prototype.ReadBasicPointer = function(len, array_type) {
      var isArray = this.ntou1();

      if (isArray === 1)
         return this.ReadFastArray(len, array_type);

      return new Array();
   }

   JSROOT.TBuffer.prototype.ReadTObject = function(tobj) {
      this.o += 2; // skip version
      if ((!'_typename' in tobj) || (tobj['_typename'] == ''))
         tobj['_typename'] = "TObject";

      tobj['fUniqueID'] = this.ntou4();
      tobj['fBits'] = this.ntou4();
      return true;
   }

   JSROOT.TBuffer.prototype.ReadTNamed = function(tobj) {
      // read a TNamed class definition from I/O buffer
      var ver = this.ReadVersion();
      this.ReadTObject(tobj);
      tobj['fName'] = this.ReadTString();
      tobj['fTitle'] = this.ReadTString();
      return this.CheckBytecount(ver, "ReadTNamed");
   }

   JSROOT.TBuffer.prototype.ReadTObjString = function(tobj) {
      // read a TObjString definition from I/O buffer
      var ver = this.ReadVersion();
      this.ReadTObject(tobj);
      tobj['fString'] = this.ReadTString();
      return this.CheckBytecount(ver, "ReadTObjString");
   }

   JSROOT.TBuffer.prototype.ReadTList = function(list) {
      // stream all objects in the list from the I/O buffer
      list['_typename'] = "TList";
      list['name'] = "";
      list['arr'] = new Array;
      list['opt'] = new Array;
      var ver = this.ReadVersion();
      if (ver['val'] > 3) {
         this.ReadTObject(list);
         list['name'] = this.ReadTString();
         var nobjects = this.ntou4();
         for (var i = 0; i < nobjects; ++i) {

            var obj = this.ReadObjectAny();
            list['arr'].push(obj);

            var opt = this.ReadTString();
            list['opt'].push(opt);
         }
      }

      return this.CheckBytecount(ver);
   }

   JSROOT.TBuffer.prototype.ReadTObjArray = function(list) {
      list['_typename'] = "TObjArray";
      list['name'] = "";
      list['arr'] = new Array();
      var ver = this.ReadVersion();
      if (ver['val'] > 2)
         this.ReadTObject(list);
      if (ver['val'] > 1)
         list['name'] = this.ReadTString();
      var nobjects = this.ntou4();
      var lowerbound = this.ntou4();
      for (var i = 0; i < nobjects; i++) {
         var obj = this.ReadObjectAny();
         list['arr'].push(obj);
      }
      return this.CheckBytecount(ver, "ReadTObjArray");
   }

   JSROOT.TBuffer.prototype.ReadTClonesArray = function(list) {
      list['_typename'] = "TClonesArray";
      list['name'] = "";
      list['arr'] = new Array();
      var ver = this.ReadVersion();
      if (ver['val'] > 2)
         this.ReadTObject(list);
      if (ver['val'] > 1)
         list['name'] = this.ReadTString();
      var s = this.ReadTString();
      var classv = s;
      var clv = 0;
      var pos = s.indexOf(";");
      if (pos != -1) {
         classv = s.slice(0, pos);
         s = s.slice(pos+1, s.length()-pos-1);
         clv = parseInt(s);
      }
      var nobjects = this.ntou4();
      if (nobjects < 0) nobjects = -nobjects;  // for backward compatibility
      var lowerbound = this.ntou4();
      for (var i = 0; i < nobjects; i++) {
         var obj = {};

         this.ClassStreamer(obj, classv);

         list['arr'].push(obj);
      }
      return this.CheckBytecount(ver, "ReadTClonesArray");
   }

   JSROOT.TBuffer.prototype.ReadTPolyMarker3D = function(marker) {
      var ver = this.ReadVersion();

      this.ReadTObject(marker);

      this.ClassStreamer(marker, "TAttMarker");

      marker['fN'] = this.ntoi4();

      marker['fP'] = this.ReadFastArray(marker['fN']*3, JSROOT.IO.kFloat);

      marker['fOption'] = this.ReadTString();

      if (ver['val'] > 1)
         marker['fName'] = this.ReadTString();
      else
         marker['fName'] = "TPolyMarker3D";

      return this.CheckBytecount(ver, "ReadTPolyMarker3D");
   }

   JSROOT.TBuffer.prototype.ReadTCollection = function(list, str, o) {
      list['_typename'] = "TCollection";
      list['name'] = "";
      list['arr'] = new Array();
      var ver = this.ReadVersion();
      if (ver['val'] > 2)
         this.ReadTObject(list);
      if (ver['val'] > 1)
         list['name'] = this.ReadTString();
      var nobjects = this.ntou4();
      for (var i = 0; i < nobjects; i++) {
         o += 10; // skip object bits & unique id
         list['arr'].push(null);
      }
      return this.CheckBytecount(ver,"ReadTCollection");
   }

   JSROOT.TBuffer.prototype.ReadTKey = function(key) {
      key['fNbytes'] = this.ntoi4();
      key['fVersion'] = this.ntoi2();
      key['fObjlen'] = this.ntou4();
      var datime = this.ntou4();
      key['fDatime'] = new Date();
      key['fDatime'].setFullYear((datime >>> 26) + 1995);
      key['fDatime'].setMonth((datime << 6) >>> 28);
      key['fDatime'].setDate((datime << 10) >>> 27);
      key['fDatime'].setHours((datime << 15) >>> 27);
      key['fDatime'].setMinutes((datime << 20) >>> 26);
      key['fDatime'].setSeconds((datime << 26) >>> 26);
      key['fDatime'].setMilliseconds(0);
      key['fKeylen'] = this.ntou2();
      key['fCycle'] = this.ntou2();
      if (key['fVersion'] > 1000) {
         key['fSeekKey'] = this.ntou8();
         this.shift(8); // skip seekPdir
      } else {
         key['fSeekKey'] = this.ntou4();
         this.shift(4); // skip seekPdir
      }
      key['fClassName'] = this.ReadTString();
      key['fName'] = this.ReadTString();
      key['fTitle'] = this.ReadTString();

      var name = key['fName'].replace(/['"]/g,'');

      if (name != key['fName']) {
         key['fRealName'] = key['fName'];
         key['fName'] = name;
      }

      return true;
   }

   JSROOT.TBuffer.prototype.ReadTBasket = function(obj) {
      this.ReadTKey(obj);
      var ver = this.ReadVersion();
      obj['fBufferSize'] = this.ntoi4();
      obj['fNevBufSize'] = this.ntoi4();
      obj['fNevBuf'] = this.ntoi4();
      obj['fLast'] = this.ntoi4();
      var flag = this.ntoi1();
      // here we implement only data skipping, no real I/O for TBasket is performed
      if ((flag % 10) != 2) {
         var sz = this.ntoi4(); this.o += sz*4; // fEntryOffset
         if (flag>40) { sz = this.ntoi4(); this.o += sz*4; } // fDisplacement
      }

      if (flag == 1 || flag > 10) {
         var sz = obj['fLast'];
         if (ver['val'] <=1) sz = this.ntoi4();
         this.o += sz; // fBufferRef
      }
      return this.CheckBytecount(ver,"ReadTBasket");
   }

   JSROOT.TBuffer.prototype.ReadTCanvas = function(obj) {
      // stream all objects in the list from the I/O buffer
      var ver = this.ReadVersion();

      this.ClassStreamer(obj, "TPad");

      obj['fDISPLAY'] = this.ReadTString();
      obj['fDoubleBuffer'] = this.ntoi4();
      obj['fRetained'] = this.ntou1()!=0;
      obj['fXsizeUser'] = this.ntoi4();
      obj['fYsizeUser'] = this.ntoi4();
      obj['fXsizeReal'] = this.ntoi4();
      obj['fYsizeReal'] = this.ntoi4();
      obj['fWindowTopX'] = this.ntoi4();
      obj['fWindowTopY'] = this.ntoi4();
      obj['fWindowWidth'] = this.ntoi4();
      obj['fWindowHeight'] = this.ntoi4();
      obj['fCw'] = this.ntou4();
      obj['fCh'] = this.ntou4();

      obj['fCatt'] = {};
      this.ClassStreamer(obj['fCatt'], "TAttCanvas");
      this.ntou1(); // ignore b << TestBit(kMoveOpaque);
      this.ntou1(); // ignore b << TestBit(kResizeOpaque);
      obj['fHighLightColor'] = this.ntoi2();
      obj['fBatch'] = this.ntou1()!=0;
      this.ntou1();   // ignore b << TestBit(kShowEventStatus);
      this.ntou1();   // ignore b << TestBit(kAutoExec);
      this.ntou1();   // ignore b << TestBit(kMenuBar);

      // now TCanvas streamer should be complete - verify that bytecount is correct
      return this.CheckBytecount(ver, "TCanvas");
   }

   JSROOT.TBuffer.prototype.ReadTStreamerInfo = function(streamerinfo) {
      // stream an object of class TStreamerInfo from the I/O buffer

      var R__v = this.ReadVersion();
      if (R__v['val'] > 1) {
         this.ReadTNamed(streamerinfo);

         streamerinfo['fCheckSum'] = this.ntou4();
         streamerinfo['fClassVersion'] = this.ntou4();

         streamerinfo['fElements'] = this.ReadObjectAny();
      }
      return this.CheckBytecount(R__v, "ReadTStreamerInfo");
   }

   JSROOT.TBuffer.prototype.ReadStreamerElement = function(element) {
      // stream an object of class TStreamerElement

      var R__v = this.ReadVersion();
      this.ReadTNamed(element);
      element['type'] = this.ntou4();
      element['size'] = this.ntou4();
      element['length'] = this.ntou4();
      element['dim'] = this.ntou4();
      if (R__v['val'] == 1)
         element['maxindex'] = this.ReadFastArray(this.ntou4(), JSROOT.IO.kUInt);
      else
         element['maxindex'] = this.ReadFastArray(5, JSROOT.IO.kUInt);

      element['fTypeName'] = this.ReadTString();
      element['typename'] = element['fTypeName']; // TODO - should be removed
      if ((element['type'] == 11) && (element['typename'] == "Bool_t" ||
            element['typename'] == "bool"))
         element['type'] = 18;
      if (R__v['val'] > 1) {
         element['uuid'] = 0;
      }
      if (R__v['val'] <= 2) {
         // In TStreamerElement v2, fSize was holding the size of
         // the underlying data type.  In later version it contains
         // the full length of the data member.
      }
      if (R__v['val'] == 3) {
         element['xmin'] = this.ntou4();
         element['xmax'] = this.ntou4();
         element['factor'] = this.ntou4();
         //if (element['factor'] > 0) SetBit(kHasRange);
      }
      if (R__v['val'] > 3) {
         //if (TestBit(kHasRange)) GetRange(GetTitle(),fXmin,fXmax,fFactor);
      }
      return this.CheckBytecount(R__v, "ReadStreamerElement");
   }

   JSROOT.TBuffer.prototype.ReadStreamerBase = function(streamerbase) {
      // stream an object of class TStreamerBase

      var R__v = this.ReadVersion();
      this.ReadStreamerElement(streamerbase);
      if (R__v['val'] > 2) {
         streamerbase['baseversion'] = this.ntou4();
      }
      return this.CheckBytecount(R__v, "ReadStreamerBase");
   }

   JSROOT.TBuffer.prototype.ReadStreamerSubElement = function(streamerbase, lmt) {
      // stream an object class derived from TStreamerElement
      // without data members, check version number
      if (lmt==null) lmt = 1;

      var R__v = this.ReadVersion();
      if (R__v['val'] > lmt) {
         this.ReadStreamerElement(streamerbase);
      }
      return this.CheckBytecount(R__v, "ReadStreamerSubElement");
   }

   JSROOT.TBuffer.prototype.ReadStreamerBasicPointer = function(streamerbase) {
      // stream an object of class TStreamerBasicPointer
      var R__v = this.ReadVersion();
      if (R__v['val'] > 1) {
         this.ReadStreamerElement(streamerbase);
         streamerbase['countversion'] = this.ntou4();
         streamerbase['countName'] = this.ReadTString();
         streamerbase['countClass'] = this.ReadTString();
      }
      return this.CheckBytecount(R__v, "ReadStreamerBasicPointer");
   }

   JSROOT.TBuffer.prototype.ReadStreamerSTL = function(streamerSTL) {
      // stream an object of class TStreamerSTL

      var R__v = this.ReadVersion();
      if (R__v['val'] > 1) {
         this.ReadStreamerElement(streamerSTL);
         streamerSTL['stltype'] = this.ntou4();
         streamerSTL['ctype'] = this.ntou4();
      }
      return this.CheckBytecount(R__v, "ReadStreamerSTL");
   }

   JSROOT.TBuffer.prototype.ReadClass = function() {
      // read class definition from I/O buffer
      var classInfo = { name: -1 };
      var tag = 0;
      var bcnt = this.ntou4();

      var startpos = this.o;
      if (!(bcnt & JSROOT.IO.kByteCountMask) || (bcnt == JSROOT.IO.kNewClassTag)) {
         tag = bcnt;
         bcnt = 0;
      } else {
         // classInfo['fVersion'] = 1;
         tag = this.ntou4();
      }
      if (!(tag & JSROOT.IO.kClassMask)) {
         classInfo['objtag'] = tag; // indicate that we have deal with objects tag
         return classInfo;
      }
      if (tag == JSROOT.IO.kNewClassTag) {
         // got a new class description followed by a new object
         classInfo['name'] = this.ReadString();

         if (this.GetMappedClass(this.fTagOffset + startpos + JSROOT.IO.kMapOffset)==-1)
            this.MapClass(this.fTagOffset + startpos + JSROOT.IO.kMapOffset, classInfo['name']);
      }
      else {
         // got a tag to an already seen class
         var clTag = (tag & ~JSROOT.IO.kClassMask);
         classInfo['name'] = this.GetMappedClass(clTag);

         if (classInfo['name']==-1) {
            alert("Did not found class with tag " + clTag);
         }

      }
      // classInfo['cnt'] = (bcnt & ~JSROOT.IO.kByteCountMask);

      return classInfo;
   }

   JSROOT.TBuffer.prototype.ReadObjectAny = function() {
      var startpos = this.o;
      var clRef = this.ReadClass();

      // class identified as object and should be handled so
      if ('objtag' in clRef)
         return this.GetMappedObject(clRef['objtag']);

      if (clRef['name'] == -1) return null;

      var obj = {};

      this.MapObject(this.fTagOffset + startpos + JSROOT.IO.kMapOffset, obj);

      this.ClassStreamer(obj, clRef['name']);

      return obj;
   }

   JSROOT.TBuffer.prototype.ReadSpecial = function(typ, typname, cnt) {
      // For the moment only few cases are supported,
      // later one could made more generic approach here

      var ver = this.ReadVersion();
      var res = null;

      if (typname == "TString*") {
         if (typeof cnt == 'undefined') cnt = 0;
         res = new Array(cnt);
         for (var i = 0; i < cnt; ++i )
            res[i] = this.ReadTString();
      } else
      if (typname == "vector<double>") res = this.ReadFastArray(this.ntoi4(), JSROOT.IO.kDouble); else
      if (typname == "vector<int>") res = this.ReadFastArray(this.ntoi4(),JSROOT.IO.kInt); else
      if (typname == "vector<float>") res = this.ReadFastArray(this.ntoi4(),JSROOT.IO.kFloat); else
      if (typname == "vector<TObject*>") {
         var n = this.ntoi4();
         res = [];
         for (var i=0;i<n;++i) res.push(this.ReadObjectAny());
      }  else
      if (typname.indexOf("map<TString,int")==0) {
         var n = this.ntoi4();
         res = [];
         for (var i=0;i<n;++i) {
            var str = this.ReadTString();
            var val = this.ntoi4();
            res.push({ first: str, second: val});
         }
      } else {
         JSROOT.console('failed to stream element of type ' + typname);
      }

      if (!this.CheckBytecount(ver,"Reading " + typname)) res = null;

      return res;
   }

   JSROOT.TBuffer.prototype.ClassStreamer = function(obj, classname) {

      // if (this.progress) this.CheckProgress();

      if (! ('_typename' in obj))  obj['_typename'] = classname;

      if (classname == 'TObject' || classname == 'TMethodCall') {
         this.ReadTObject(obj);
      }
      else if (classname == 'TQObject') {
         // skip TQObject
      }
      else if (classname == 'TObjString') {
         this.ReadTObjString(obj);
      }
      else if (classname == 'TObjArray') {
         this.ReadTObjArray(obj);
      }
      else if (classname == 'TClonesArray') {
         this.ReadTClonesArray(obj);
      }
      else if ((classname == 'TList') || (classname == 'THashList')) {
         this.ReadTList(obj);
      }
      else if (classname == 'TCollection') {
         this.ReadTCollection(obj);
         alert("Trying to read TCollection - wrong!!!");
      }
      else if (classname == 'TCanvas') {
         this.ReadTCanvas(obj);
      }
      else if (classname == 'TPolyMarker3D') {
         this.ReadTPolyMarker3D(obj);
      }
      else if (classname == "TStreamerInfo") {
         this.ReadTStreamerInfo(obj);
      }
      else if (classname == "TStreamerBase") {
         this.ReadStreamerBase(obj);
      }
      else if ((classname == "TStreamerBasicPointer") || (classname == "TStreamerLoop")) {
         this.ReadStreamerBasicPointer(obj);
      }
      else if (classname == "TStreamerSTL") {
         this.ReadStreamerSTL(obj);
      }
      else if (classname == "TStreamerObject" || classname == "TStreamerBasicType" ||
            classname == "TStreamerObjectAny" || classname == "TStreamerString" ||
            classname == "TStreamerObjectPointer") {
         this.ReadStreamerSubElement(obj);
      }
      else if (classname == "TStreamerObjectAnyPointer") {
         this.ReadStreamerSubElement(obj, 0);
      }
      else if (classname == "TBasket") {
         this.ReadTBasket(obj);
      }
      else {
         var streamer = this.fFile.GetStreamer(classname);
         if (streamer != null) {
            streamer.Stream(obj, this);
         } else {
            JSROOT.console("Did not found streamer for class " + classname + " try to skip data");
            var ver = this.ReadVersion();
            this.CheckBytecount(ver);
         }
      }

      JSROOT.addMethods(obj);

      return obj;
   }

   // =================================================================================

   JSROOT.TStrBuffer = function(str, pos, file) {
      JSROOT.TBuffer.call(this, pos, file);
      this.b = str;
   }

   JSROOT.TStrBuffer.prototype = Object.create(JSROOT.TBuffer.prototype);

   JSROOT.TStrBuffer.prototype.totalLength = function() {
      return this.b ? this.b.length : 0;
   }

   JSROOT.TStrBuffer.prototype.extract = function(off,len) {
      return this.b.substr(off, len);
   }

   JSROOT.TStrBuffer.prototype.ntou1 = function() {
      return (this.b.charCodeAt(this.o++) & 0xff) >>> 0;
   }

   JSROOT.TStrBuffer.prototype.ntou2 = function() {
      // convert (read) two bytes of buffer b into a UShort_t
      var n = ((this.b.charCodeAt(this.o) & 0xff) << 8) >>> 0;
      n += (this.b.charCodeAt(this.o+1) & 0xff) >>> 0;
      this.o += 2;
      return n;
   }

   JSROOT.TStrBuffer.prototype.ntou4 = function() {
      // convert (read) four bytes of buffer b into a UInt_t
      var n  = ((this.b.charCodeAt(this.o++) & 0xff) << 24) >>> 0;
      n += ((this.b.charCodeAt(this.o++) & 0xff) << 16) >>> 0;
      n += ((this.b.charCodeAt(this.o++) & 0xff) << 8)  >>> 0;
      n +=  (this.b.charCodeAt(this.o++) & 0xff) >>> 0;
      return n;
   }

   JSROOT.TStrBuffer.prototype.ntou8 = function() {
      // convert (read) eight bytes of buffer b into a ULong_t
      var n = ((this.b.charCodeAt(this.o++) & 0xff) << 56) >>> 0;
      n += ((this.b.charCodeAt(this.o++) & 0xff) << 48) >>> 0;
      n += ((this.b.charCodeAt(this.o++) & 0xff) << 40) >>> 0;
      n += ((this.b.charCodeAt(this.o++) & 0xff) << 32) >>> 0;
      n += ((this.b.charCodeAt(this.o++) & 0xff) << 24) >>> 0;
      n += ((this.b.charCodeAt(this.o++) & 0xff) << 16) >>> 0;
      n += ((this.b.charCodeAt(this.o++) & 0xff) << 8) >>> 0;
      n +=  (this.b.charCodeAt(this.o++) & 0xff) >>> 0;
      return n;
   }

   JSROOT.TStrBuffer.prototype.ntoi1 = function() {
      return (this.b.charCodeAt(this.o++) & 0xff);
   }

   JSROOT.TStrBuffer.prototype.ntoi2 = function() {
      // convert (read) two bytes of buffer b into a Short_t
      var n = (this.b.charCodeAt(this.o++) & 0xff) << 8;
      n += (this.b.charCodeAt(this.o++) & 0xff);
      return n;
   }

   JSROOT.TStrBuffer.prototype.ntoi4 = function() {
      // convert (read) four bytes of buffer b into a Int_t
      var n = ((this.b.charCodeAt(this.o++) & 0xff) << 24);
      n +=  ((this.b.charCodeAt(this.o++) & 0xff) << 16);
      n += ((this.b.charCodeAt(this.o++) & 0xff) << 8);
      n += ((this.b.charCodeAt(this.o++) & 0xff));
      return n;
   }

   JSROOT.TStrBuffer.prototype.ntoi8 = function(b, o) {
      // convert (read) eight bytes of buffer b into a Long_t
      var n = (this.b.charCodeAt(this.o++) & 0xff) << 56;
      n += (this.b.charCodeAt(this.o++) & 0xff) << 48;
      n += (this.b.charCodeAt(this.o++) & 0xff) << 40;
      n += (this.b.charCodeAt(this.o++) & 0xff) << 32;
      n += (this.b.charCodeAt(this.o++) & 0xff) << 24;
      n += (this.b.charCodeAt(this.o++) & 0xff) << 16;
      n += (this.b.charCodeAt(this.o++) & 0xff) << 8;
      n += (this.b.charCodeAt(this.o++) & 0xff);
      return n;
   }

   JSROOT.TStrBuffer.prototype.ntof = function() {
      // IEEE-754 Floating-Point Conversion (single precision - 32 bits)
      var inString = this.b.substring(this.o, this.o + 4); this.o+=4;
      if (inString.length < 4) return Number.NaN;
      var bits = "";
      for (var i=0; i<4; ++i) {
         var curByte = (inString.charCodeAt(i) & 0xff).toString(2);
         var byteLen = curByte.length;
         if (byteLen < 8) {
            for (var bit=0; bit<(8-byteLen); ++bit)
               curByte = '0' + curByte;
         }
         bits = bits + curByte;
      }
      //var bsign = parseInt(bits[0]) ? -1 : 1;
      var bsign = (bits.charAt(0) == '1') ? -1 : 1;
      var bexp = parseInt(bits.substring(1, 9), 2) - 127;
      var bman;
      if (bexp == -127)
         bman = 0;
      else {
         bman = 1;
         for (var i=0; i<23; ++i) {
            if (parseInt(bits.substr(9+i, 1)) == 1)
               bman = bman + 1 / Math.pow(2, i+1);
         }
      }
      var res = bsign * Math.pow(2, bexp) * bman;
      return (Math.abs(res) < 1e-300) ? 0.0 : res;
   }

   JSROOT.TStrBuffer.prototype.ntod = function() {
      // IEEE-754 Floating-Point Conversion (double precision - 64 bits)
      var inString = this.b.substring(this.o, this.o + 8); this.o+=8;
      if (inString.length < 8) return Number.NaN;
      var bits = "";
      for (var i=0; i<8; ++i) {
         var curByte = (inString.charCodeAt(i) & 0xff).toString(2);
         var byteLen = curByte.length;
         if (byteLen < 8) {
            for (var bit=0; bit<(8-byteLen); ++bit)
               curByte = '0' + curByte;
         }
         bits = bits + curByte;
      }
      //var bsign = parseInt(bits[0]) ? -1 : 1;
      var bsign = (bits.charAt(0) == '1') ? -1 : 1;
      var bexp = parseInt(bits.substring(1, 12), 2) - 1023;
      var bman;
      if (bexp == -127)
         bman = 0;
      else {
         bman = 1;
         for (var i=0; i<52; ++i) {
            if (parseInt(bits.substr(12+i, 1)) == 1)
               bman = bman + 1 / Math.pow(2, i+1);
         }
      }
      var res = (bsign * Math.pow(2, bexp) * bman);
      return (Math.abs(res) < 1e-300) ? 0.0 : res;
   }

   JSROOT.TStrBuffer.prototype.codeAt = function(pos) {
      return this.b.charCodeAt(pos) & 0xff;
   }

   JSROOT.TStrBuffer.prototype.substring = function(beg, end) {
      return this.b.substring(beg, end);
   }

   // =======================================================================

   JSROOT.TArrBuffer = function(arr, pos, file) {
      // buffer should work with DataView as first argument
      JSROOT.TBuffer.call(this, pos, file);
      this.arr = arr;
   }

   JSROOT.TArrBuffer.prototype = Object.create(JSROOT.TBuffer.prototype);

   JSROOT.TArrBuffer.prototype.totalLength = function() {
      return this.arr && this.arr.buffer ? this.arr.buffer.byteLength : 0;
   }

   JSROOT.TArrBuffer.prototype.extract = function(off,len) {
      if (!this.arr || !this.arr.buffer || (this.arr.buffer.byteLength < off+len)) return null;
      return new DataView(this.arr.buffer, off,  len);
   }

   JSROOT.TArrBuffer.prototype.codeAt = function(pos) {
      return this.arr.getUint8(pos);
   }

   JSROOT.TArrBuffer.prototype.substring = function(beg, end) {
      var res = "";
      for (var n=beg;n<end;++n)
         res += String.fromCharCode(this.arr.getUint8(n));
      return res;
   }

   JSROOT.TArrBuffer.prototype.ntou1 = function() {
      return this.arr.getUint8(this.o++);
   }

   JSROOT.TArrBuffer.prototype.ntou2 = function() {
      var o = this.o; this.o+=2;
      return this.arr.getUint16(o);
   }

   JSROOT.TArrBuffer.prototype.ntou4 = function() {
      var o = this.o; this.o+=4;
      return this.arr.getUint32(o);
   }

   JSROOT.TArrBuffer.prototype.ntou8 = function() {
      var high = this.arr.getUint32(this.o); this.o+=4;
      var low = this.arr.getUint32(this.o); this.o+=4;
      return high * 0x100000000 + low;
   }

   JSROOT.TArrBuffer.prototype.ntoi1 = function() {
      return this.arr.getInt8(this.o++);
   }

   JSROOT.TArrBuffer.prototype.ntoi2 = function() {
      var o = this.o; this.o+=2;
      return this.arr.getInt16(o);
   }

   JSROOT.TArrBuffer.prototype.ntoi4 = function() {
      var o = this.o; this.o+=4;
      return this.arr.getInt32(o);
   }

   JSROOT.TArrBuffer.prototype.ntoi8 = function() {
      var high = this.arr.getUint32(this.o); this.o+=4;
      var low = this.arr.getUint32(this.o); this.o+=4;
      if (high < 0x80000000) return high * 0x100000000 + low;
      return -1 - ((~high) * 0x100000000 + ~low);
   }

   JSROOT.TArrBuffer.prototype.ntof = function() {
      var o = this.o; this.o+=4;
      return this.arr.getFloat32(o);
   }

   JSROOT.TArrBuffer.prototype.ntod = function() {
      var o = this.o; this.o+=8;
      return this.arr.getFloat64(o);
   }

   // =======================================================================

   JSROOT.CreateTBuffer = function(blob, pos, file) {
      if ((blob==null) || (typeof(blob) == 'string'))
         return new JSROOT.TStrBuffer(blob, pos, file);

      return new JSROOT.TArrBuffer(blob, pos, file);
   }

   JSROOT.ReconstructObject = function(class_name, obj_rawdata, sinfo_rawdata) {
      // method can be used to reconstruct ROOT object from binary buffer
      // Buffer can be requested from online server with request like:
      //   http://localhost:8080/Files/job1.root/hpx/root.bin
      // One also requires buffer with streamer infos, reqeusted with command
      //   http://localhost:8080/StreamerInfo/root.bin
      // And one should provide class name of the object
      //
      // Method provided for convenience only to see how binary JSROOT.IO works.
      // It is strongly recommended to use JSON representation:
      //   http://localhost:8080/Files/job1.root/hpx/root.json

      var file = new JSROOT.TFile;
      var buf = JSROOT.CreateTBuffer(sinfo_rawdata, 0, file);
      file.ExtractStreamerInfos(buf);

      var obj = {};

      buf = JSROOT.CreateTBuffer(obj_rawdata, 0, file);
      buf.MapObject(obj, 1);
      buf.ClassStreamer(obj, class_name);

      return obj;
   }

   // ==============================================================================

   // ctor
   JSROOT.TStreamerInfo = function(file) {
      this.fFile = file;
      this._typename = "TStreamerInfo";
      this._base_classes = []; // list of base classes
      this._class_members = []; // list of members
      return this;
   }

   JSROOT.TStreamerInfo.prototype.Stream = function(obj, buf) {

      var ver = buf.ReadVersion();

      // first base classes
      for (var n = 0; n < this._base_classes.length; ++n) {
         var clname = this._base_classes[n]['classname'];
         if (clname.indexOf("TArray") == 0) {
            obj['fArray'] = buf.ReadTArray(clname, buf.ntou4());
         } else {
            buf.ClassStreamer(obj, clname);
         }
      }

      // then class members
      for (var n = 0; n < this._class_members.length; ++n) {
         var member = this._class_members[n];
         var prop = member.name;

         if (JSROOT.fUserStreamers !== null) {
            var user_func = JSROOT.fUserStreamers[member.typename];

            if (user_func !== undefined) {
               user_func(buf, obj, prop, this);
               continue;
            }
         }

         switch (member['type']) {
            case JSROOT.IO.kBase:
               break;
            case JSROOT.IO.kOffsetL:
               break;
            case JSROOT.IO.kOffsetP:
               break;
            case JSROOT.IO.kCharStar:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kChar);
               break;
            case JSROOT.IO.kChar:
            case JSROOT.IO.kLegacyChar:
               obj[prop] = buf.ntou1();
               break;
            case JSROOT.IO.kShort:
               obj[prop] = buf.ntoi2();
               break;
            case JSROOT.IO.kInt:
            case JSROOT.IO.kCounter:
               obj[prop] = buf.ntoi4();
               break;
            case JSROOT.IO.kLong:
               obj[prop] = buf.ntoi8();
               break;
            case JSROOT.IO.kFloat:
            case JSROOT.IO.kDouble32:
               obj[prop] = buf.ntof();
               break;
            case JSROOT.IO.kDouble:
               obj[prop] = buf.ntod();
               break;
            case JSROOT.IO.kUChar:
               obj[prop] = buf.ntou1();
               break;
            case JSROOT.IO.kUShort:
               obj[prop] = buf.ntou2();
               break;
            case JSROOT.IO.kUInt:
               obj[prop] = buf.ntou4();
               break;
            case JSROOT.IO.kULong:
               obj[prop] = buf.ntou8();
               break;
            case JSROOT.IO.kBits:
               alert('failed to stream bits ' + prop + ' (' + member['typename'] + ')');
               break;
            case JSROOT.IO.kLong64:
               obj[prop] = buf.ntoi8();
               break;
            case JSROOT.IO.kULong64:
               obj[prop] = buf.ntou8();
               break;
            case JSROOT.IO.kBool:
               obj[prop] = buf.ntou1() != 0;
               break;
            case JSROOT.IO.kFloat16:
               obj[prop] = 0;
               buf.o += 2;
               break;
            case JSROOT.IO.kAny:
            case JSROOT.IO.kAnyp:
            case JSROOT.IO.kObjectp:
            case JSROOT.IO.kObject:
               var classname = member['typename'];
               if (classname.charAt(classname.length-1) == "*")
                  classname = classname.substr(0, classname.length - 1);

               if (classname.indexOf("TArray")==0)
                  obj[prop] = buf.ReadTArray(classname, buf.ntou4());
               else
                  obj[prop] = buf.ClassStreamer({}, classname);

               break;

            case JSROOT.IO.kAnyP:
            case JSROOT.IO.kObjectP:
               obj[prop] = buf.ReadObjectAny();
               break;
            case JSROOT.IO.kTString:
               obj[prop] = buf.ReadTString();
               break;
            case JSROOT.IO.kTObject:
               buf.ReadTObject(obj);
               break;
            case JSROOT.IO.kTNamed:
               buf.ReadTNamed(obj);
               break;
               //case JSROOT.IO.kAnyPnoVT:
               //case JSROOT.IO.kSTLp:
               //case JSROOT.IO.kSTL:
               //case JSROOT.IO.kSkip:
               //case JSROOT.IO.kSkipL:
               //case JSROOT.IO.kSkipP:
               //case JSROOT.IO.kConv:
               //case JSROOT.IO.kConvL:
               //case JSROOT.IO.kConvP:
               //case JSROOT.IO.kSTLstring:
            case JSROOT.IO.kStreamLoop:
            case JSROOT.IO.kStreamer:
               obj[prop] = buf.ReadSpecial(member['type'], member['typename'], obj[member['cntname']]);
               break;
            case JSROOT.IO.kOffsetL+JSROOT.IO.kShort:
               obj[prop] = buf.ReadFastArray(member['length'], JSROOT.IO.kShort);
               break;
            case JSROOT.IO.kOffsetL+JSROOT.IO.kUShort:
               obj[prop] = buf.ReadFastArray(member['length'], JSROOT.IO.kUShort);
               break;
            case JSROOT.IO.kOffsetL+JSROOT.IO.kInt:
               obj[prop] = buf.ReadFastArray(member['length'], JSROOT.IO.kInt);
               break;
            case JSROOT.IO.kOffsetL+JSROOT.IO.kUInt:
               obj[prop] = buf.ReadFastArray(member['length'], JSROOT.IO.kUInt);
               break;
            case JSROOT.IO.kOffsetL+JSROOT.IO.kULong:
            case JSROOT.IO.kOffsetL+JSROOT.IO.kULong64:
               obj[prop] = buf.ReadFastArray(member['length'], JSROOT.IO.kULong64);
               break;
            case JSROOT.IO.kOffsetL+JSROOT.IO.kLong:
            case JSROOT.IO.kOffsetL+JSROOT.IO.kLong64:
               obj[prop] = buf.ReadFastArray(member['length'], JSROOT.IO.kLong64);
               break;
            case JSROOT.IO.kOffsetL+JSROOT.IO.kFloat:
            case JSROOT.IO.kOffsetL+JSROOT.IO.kDouble32:
               obj[prop] = buf.ReadFastArray(member['length'], JSROOT.IO.kFloat);
               break;
            case JSROOT.IO.kOffsetL+JSROOT.IO.kDouble:
               obj[prop] = buf.ReadFastArray(member['length'], JSROOT.IO.kDouble);
               break;
            case JSROOT.IO.kOffsetP+JSROOT.IO.kUChar:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kUChar);
               break;
            case JSROOT.IO.kOffsetP+JSROOT.IO.kChar:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kChar);
               break;
            case JSROOT.IO.kOffsetP+JSROOT.IO.kShort:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kShort);
               break;
            case JSROOT.IO.kOffsetP+JSROOT.IO.kUShort:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kUShort);
               break;
            case JSROOT.IO.kOffsetP+JSROOT.IO.kInt:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kInt);
               break;
            case JSROOT.IO.kOffsetP+JSROOT.IO.kUInt:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kUInt);
               break;
            case JSROOT.IO.kOffsetP+JSROOT.IO.kULong:
            case JSROOT.IO.kOffsetP+JSROOT.IO.kULong64:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kULong64);
               break;
            case JSROOT.IO.kOffsetP+JSROOT.IO.kLong:
            case JSROOT.IO.kOffsetP+JSROOT.IO.kLong64:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kLong64);
               break;
            case JSROOT.IO.kOffsetP+JSROOT.IO.kFloat:
            case JSROOT.IO.kOffsetP+JSROOT.IO.kDouble32:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kFloat);
               break;
            case JSROOT.IO.kOffsetP+JSROOT.IO.kDouble:
               obj[prop] = buf.ReadBasicPointer(obj[member['cntname']], JSROOT.IO.kDouble);
               break;
            default:
               alert('failed to stream ' + prop + ' (' + member['typename'] + ')  typ = ' + member['type']);
            break;
         }
      }

      buf.CheckBytecount(ver, "TStreamer.Stream");

      return buf.o;
   }


   // ==============================================================================

   // A class that reads a TDirectory from a buffer.

   // ctor
   JSROOT.TDirectory = function(file, dirname, cycle) {
      if (! (this instanceof arguments.callee) )
         throw new Error("you must use new to instantiate this class", "JSROOT.TDirectory.ctor");

      this.fFile = file;
      this._typename = "TDirectory";
      this['dir_name'] = dirname;
      this['dir_cycle'] = cycle;
      this.fKeys = new Array();
      return this;
   }

   JSROOT.TDirectory.prototype.GetKey = function(keyname, cycle, call_back) {
      // retrieve a key by its name and cycle in the list of keys
      for (var i=0; i < this.fKeys.length; ++i) {
         if (this.fKeys[i]['fName'] == keyname && this.fKeys[i]['fCycle'] == cycle) {
            JSROOT.CallBack(call_back, this.fKeys[i]);
            return this.fKeys[i];
         }
      }

      var pos = keyname.lastIndexOf("/");
      // try to handle situation when object name contains slashed (bad practice anyway)
      while (pos > 0) {
         var dirname = keyname.substr(0, pos);
         var subname = keyname.substr(pos+1);

         var dirkey = this.GetKey(dirname, 1);
         if ((dirkey!=null) && (typeof call_back == 'function') &&
              (dirkey['fClassName'].indexOf("TDirectory")==0)) {

            this.fFile.ReadObject(this['dir_name'] + "/" + dirname, 1, function(newdir) {
               if (newdir) newdir.GetKey(subname, cycle, call_back);
            });
            return null;
         }

         pos = keyname.lastIndexOf("/", pos-1);
      }


      JSROOT.CallBack(call_back, null);
      return null;
   }

   JSROOT.TDirectory.prototype.ReadKeys = function(readkeys_callback) {
      var thisdir = this;
      var file = this.fFile;

      //*-*-------------Read directory info
      var nbytes = this.fNbytesName + 22;
      nbytes += 4;  // fDatimeC.Sizeof();
      nbytes += 4;  // fDatimeM.Sizeof();
      nbytes += 18; // fUUID.Sizeof();
      // assume that the file may be above 2 Gbytes if file version is > 4
      if (file.fVersion >= 40000) nbytes += 12;

      file.Seek(this.fSeekDir, this.fFile.ERelativeTo.kBeg);
      file.ReadBuffer(nbytes, function(blob1) {
         if (blob1==null) return JSROOT.CallBack(readkeys_callback,null);
         var buf = JSROOT.CreateTBuffer(blob1, thisdir.fNbytesName, file);

         thisdir.StreamHeader(buf);

         //*-*---------read TKey::FillBuffer info
         buf.locate(4); // Skip NBytes;
         var keyversion = buf.ntoi2();
         // Skip ObjLen, DateTime, KeyLen, Cycle, SeekKey, SeekPdir
         if (keyversion > 1000) buf.shift(28); // Large files
                           else buf.shift(20);
         buf.ReadTString();
         buf.ReadTString();
         thisdir.fTitle = buf.ReadTString();
         if (thisdir.fNbytesName < 10 || thisdir.fNbytesName > 10000) {
            JSROOT.console("Cannot read directory info of file " + file.fURL);
            return JSROOT.CallBack(readkeys_callback, null);
         }
         //*-* -------------Read keys of the top directory

         if (thisdir.fSeekKeys <=0)
            return JSROOT.CallBack(readkeys_callback, null);

         file.Seek(thisdir.fSeekKeys, file.ERelativeTo.kBeg);
         file.ReadBuffer(thisdir.fNbytesKeys, function(blob2) {
            if (blob2 == null) return JSROOT.CallBack(readkeys_callback, null);
            var buf = JSROOT.CreateTBuffer(blob2, 0, file);

            var key = file.ReadKey(buf);

            var nkeys = buf.ntoi4();
            for (var i = 0; i < nkeys; ++i) {
               key = file.ReadKey(buf);
               thisdir.fKeys.push(key);
            }
            file.fDirectories.push(thisdir);
            delete buf;

            JSROOT.CallBack(readkeys_callback, thisdir);
         });

         delete buf;
      });
   }

   JSROOT.TDirectory.prototype.StreamHeader = function(buf) {
      var version = buf.ntou2();
      var versiondir = version % 1000;
      buf.shift(8); // skip fDatimeC and fDatimeM
      this.fNbytesKeys = buf.ntou4();
      this.fNbytesName = buf.ntou4();
      this.fSeekDir = (version > 1000) ? buf.ntou8() : buf.ntou4();
      this.fSeekParent = (version > 1000) ? buf.ntou8() : buf.ntou4();
      this.fSeekKeys = (version > 1000) ? buf.ntou8() : buf.ntou4();
      if (versiondir > 2) buf.shift(18); // skip fUUID
   }


   // ==============================================================================
   // A class that reads ROOT files.
   //
   ////////////////////////////////////////////////////////////////////////////////
   // A ROOT file is a suite of consecutive data records (TKey's) with
   // the following format (see also the TKey class). If the key is
   // located past the 32 bit file limit (> 2 GB) then some fields will
   // be 8 instead of 4 bytes:
   //    1->4            Nbytes    = Length of compressed object (in bytes)
   //    5->6            Version   = TKey version identifier
   //    7->10           ObjLen    = Length of uncompressed object
   //    11->14          Datime    = Date and time when object was written to file
   //    15->16          KeyLen    = Length of the key structure (in bytes)
   //    17->18          Cycle     = Cycle of key
   //    19->22 [19->26] SeekKey   = Pointer to record itself (consistency check)
   //    23->26 [27->34] SeekPdir  = Pointer to directory header
   //    27->27 [35->35] lname     = Number of bytes in the class name
   //    28->.. [36->..] ClassName = Object Class Name
   //    ..->..          lname     = Number of bytes in the object name
   //    ..->..          Name      = lName bytes with the name of the object
   //    ..->..          lTitle    = Number of bytes in the object title
   //    ..->..          Title     = Title of the object
   //    ----->          DATA      = Data bytes associated to the object
   //


   // ctor
   JSROOT.TFile = function(url, newfile_callback) {
      if (! (this instanceof arguments.callee) )
         throw new Error("you must use new to instantiate this class", "JSROOT.TFile.ctor");

      this._typename = "TFile";
      this.fOffset = 0;
      this.fEND = 0;
      this.fFullURL = url;
      this.fURL = url;
      this.fAcceptRanges = true; // when disabled ('+' at the end of file name), complete file content read with single operation
      this.fUseStampPar = new Date; // use additional time stamp parameter for file name to avoid browser caching problem
      this.fFileContent = null; // this can be full or parial content of the file (if ranges are not supported or if 1K header read from file)
                                // stored as TBuffer instance

      this.ERelativeTo = { kBeg : 0, kCur : 1, kEnd : 2 };
      this.fDirectories = new Array();
      this.fKeys = new Array();
      this.fSeekInfo = 0;
      this.fNbytesInfo = 0;
      this.fTagOffset = 0;
      this.fStreamers = 0;
      this.fStreamerInfos = null;
      this.fFileName = "";
      this.fStreamers = new Array;

      if (typeof this.fURL != 'string') return this;

      if (this.fURL.charAt(this.fURL.length-1) == "+") {
         this.fURL = this.fURL.substr(0, this.fURL.length-1);
         this.fAcceptRanges = false;
      }

      var pos = Math.max(this.fURL.lastIndexOf("/"), this.fURL.lastIndexOf("\\"));
      this.fFileName = pos>=0 ? this.fURL.substr(pos+1) : this.fURL;

      if (!this.fAcceptRanges) {
         this.ReadKeys(newfile_callback);
      } else {
         var file = this;

         var xhr = JSROOT.NewHttpRequest(this.fURL, "head", function(res) {
            if (res==null)
               return JSROOT.CallBack(newfile_callback, null);

            var accept_ranges = res.getResponseHeader("Accept-Ranges");
            if (accept_ranges==null) file.fAcceptRanges = false;
            var len = res.getResponseHeader("Content-Length");
            if (len!=null) file.fEND = parseInt(len);
            else file.fAcceptRanges = false;
            file.ReadKeys(newfile_callback);
         });

         xhr.send(null);
      }

      return this;
   }

   JSROOT.TFile.prototype.ReadBuffer = function(len, callback) {

      if ((this.fFileContent!=null) && (!this.fAcceptRanges || (this.fOffset+len <= this.fFileContent.totalLength())))
         return callback(this.fFileContent.extract(this.fOffset, len));

      var file = this;

      var url = this.fURL;
      if (this.fUseStampPar) {
         // try to avoid browser caching by adding stamp parameter to URL
         if (url.indexOf('?')>0) url+="&stamp="; else url += "?stamp=";
         url += this.fUseStampPar.getTime();
      }

      function read_callback(res) {

         if ((res==null) && file.fUseStampPar && (file.fOffset==0)) {
            // if fail to read file with stamp parameter, try once again without it
            file.fUseStampPar = false;
            var xhr2 = JSROOT.NewHttpRequest(this.fURL, ((JSROOT.IO.Mode == "array") ? "buf" : "bin"), read_callback);
            if (this.fAcceptRanges)
               xhr2.setRequestHeader("Range", "bytes=" + this.fOffset + "-" + (this.fOffset + len - 1));
            xhr2.send(null);
            return;
         } else
         if ((res!=null) && (file.fOffset==0) && (file.fFileContent == null)) {
            // special case - keep content of first request (could be complete file) in memory

            file.fFileContent = JSROOT.CreateTBuffer((typeof res == 'string') ? res : new DataView(res));

            if (!this.fAcceptRanges)
               file.fEND = file.fFileContent.totalLength();

            return callback(file.fFileContent.extract(file.fOffset, len));
         }

         if ((res==null) || (res === undefined) || (typeof res == 'string'))
            return callback(res);

         // return data view with binary data
         callback(new DataView(res));
      }

      var xhr = JSROOT.NewHttpRequest(url, ((JSROOT.IO.Mode == "array") ? "buf" : "bin"), read_callback);
      if (this.fAcceptRanges)
         xhr.setRequestHeader("Range", "bytes=" + this.fOffset + "-" + (this.fOffset + len - 1));
      xhr.send(null);
   }

   JSROOT.TFile.prototype.Seek = function(offset, pos) {
      // Set position from where to start reading.
      switch (pos) {
         case this.ERelativeTo.kBeg:
            this.fOffset = offset;
            break;
         case this.ERelativeTo.kCur:
            this.fOffset += offset;
            break;
         case this.ERelativeTo.kEnd:
            // this option is not used currently in the ROOT code
            if (this.fEND == 0)
               throw new Error("Seek : seeking from end in file with fEND==0 is not supported");
            this.fOffset = this.fEND - offset;
            break;
         default:
            throw new Error("Seek : unknown seek option (" + pos + ")");
            break;
      }
   }

   JSROOT.TFile.prototype.ReadKey = function(buf) {
      // read key from buffer
      var key = {};
      buf.ReadTKey(key);
      return key;
   }

   JSROOT.TFile.prototype.GetDir = function(dirname, cycle) {
      // check first that directory with such name exists

      if ((cycle==null) && (typeof dirname == 'string')) {
         var pos = dirname.lastIndexOf(';');
         if (pos>0) { cycle = dirname.substr(pos+1); dirname = dirname.substr(0,pos); }
      }

      for (var j=0; j < this.fDirectories.length; ++j) {
         var dir = this.fDirectories[j];
         if (dir['dir_name'] != dirname) continue;
         if ((cycle!=null) && (dir['dir_cycle']!=cycle)) continue;
         return dir;
      }
      return null;
   }

   JSROOT.TFile.prototype.GetKey = function(keyname, cycle, getkey_callback) {
      // retrieve a key by its name and cycle in the list of keys
      // one should call_back when keys must be read first from the directory

      for (var i=0; i < this.fKeys.length; ++i) {
         if (this.fKeys[i]['fName'] == keyname && this.fKeys[i]['fCycle'] == cycle) {
            JSROOT.CallBack(getkey_callback, this.fKeys[i]);
            return this.fKeys[i];
         }
      }

      var pos = keyname.lastIndexOf("/");
      // try to handle situation when object name contains slashed (bad practice anyway)
      while (pos > 0) {
         var dirname = keyname.substr(0, pos);
         var subname = keyname.substr(pos+1);

         var dir = this.GetDir(dirname);
         if (dir!=null) return dir.GetKey(subname, cycle, getkey_callback);

         var dirkey = this.GetKey(dirname, 1);
         if ((dirkey!=null) && (getkey_callback != null) &&
             (dirkey['fClassName'].indexOf("TDirectory")==0)) {

            this.ReadObject(dirname, function(newdir) {
               if (newdir) newdir.GetKey(subname, cycle, getkey_callback);
            });
            return null;
         }

         pos = keyname.lastIndexOf("/", pos-1);
      }

      JSROOT.CallBack(getkey_callback, null);
      return null;
   }

   JSROOT.TFile.prototype.ReadObjBuffer = function(key, callback) {
      // read and inflate object buffer described by its key

      var file = this;

      this.Seek(key['fSeekKey'] + key['fKeylen'], this.ERelativeTo.kBeg);
      this.ReadBuffer(key['fNbytes'] - key['fKeylen'], function(blob1) {

         if (blob1==null) callback(null);

         var buf = null;

         if (key['fObjlen'] <= key['fNbytes']-key['fKeylen']) {
            buf = JSROOT.CreateTBuffer(blob1, 0, file);
         } else {
            var objbuf = JSROOT.R__unzip(blob1, key['fObjlen']);
            if (objbuf==null) return callback(null);
            buf = JSROOT.CreateTBuffer(objbuf, 0, file);
         }

         buf.fTagOffset = key.fKeylen;
         callback(buf);
         delete buf;
      });
   }

   JSROOT.TFile.prototype.ReadObject = function(obj_name, cycle, user_call_back) {
      // Read any object from a root file
      // One could specify cycle number in the object name or as separate argument
      // Last argument should be callback function, while data reading from file is asynchron

      if (typeof cycle == 'function') { user_call_back = cycle; cycle = 1; }

      var pos = obj_name.lastIndexOf(";");
      if (pos>0) {
         cycle = parseInt(obj_name.slice(pos+1));
         obj_name = obj_name.slice(0, pos);
      }

      if ((typeof cycle != 'number') || (cycle<0)) cycle = 1;
      // remove leading slashes
      while ((obj_name.length>0) && (obj_name[0] == "/")) obj_name = obj_name.substr(1);

      var file = this;

      // we use callback version while in some cases we need to
      // read sub-directory to get list of keys
      // in such situation calls are asynchrone
      this.GetKey(obj_name, cycle, function(key) {

         if (key == null)
            return JSROOT.CallBack(user_call_back, null);

         if ((obj_name=="StreamerInfo") && (key['fClassName']=="TList"))
            return file.fStreamerInfos;

         var isdir = false;
         if ((key['fClassName'] == 'TDirectory' || key['fClassName'] == 'TDirectoryFile')) {
            isdir = true;
            var dir = file.GetDir(obj_name, cycle);
            if (dir!=null)
               return JSROOT.CallBack(user_call_back, dir);
         }

         file.ReadObjBuffer(key, function(buf) {
            if (!buf) return JSROOT.CallBack(user_call_back, null);

            if (isdir) {
               var dir = new JSROOT.TDirectory(file, obj_name, cycle);
               dir.StreamHeader(buf);
               if (dir.fSeekKeys) {
                  dir.ReadKeys(user_call_back);
               } else {
                  JSROOT.CallBack(user_call_back,dir);
               }

               return;
            }

            var obj = {};
            buf.MapObject(1, obj); // tag object itself with id==1
            //buf.EnableProgress();
            buf.ClassStreamer(obj, key['fClassName']);
            //JSROOT.progress(1.);

            JSROOT.CallBack(user_call_back, obj);
         }); // end of ReadObjBuffer callback
      }); // end of GetKey callback
   }

   JSROOT.TFile.prototype.ExtractStreamerInfos = function(buf)
   {
      if (!buf) return;

      var lst = {};
      buf.MapObject(1, lst);
      buf.ClassStreamer(lst, 'TList');

      lst['_typename'] = "TStreamerInfoList";

      this.fStreamerInfos = lst;
   }

   JSROOT.TFile.prototype.ReadFormulas = function()
   {
      for (var i=0; i < this.fKeys.length; ++i)
        if (this.fKeys[i]['fClassName'] == 'TFormula')
          this.ReadObject(this.fKeys[i]['fName'], this.fKeys[i]['fCycle'], function(obj) {
             JSROOT.addFormula(obj);
         });
   }

   JSROOT.TFile.prototype.ReadStreamerInfos = function(si_callback)
   {
      if (this.fSeekInfo == 0 || this.fNbytesInfo == 0) return si_callback(null);
      this.Seek(this.fSeekInfo, this.ERelativeTo.kBeg);

      var file = this;

      file.ReadBuffer(file.fNbytesInfo, function(blob1) {
         var buf = JSROOT.CreateTBuffer(blob1, 0, file);
         var key = file.ReadKey(buf);
         if (key == null) return si_callback(null);
         file.fKeys.push(key);

         file.ReadObjBuffer(key, function(blob2) {
            if (blob2==null) return si_callback(null);
            file.ExtractStreamerInfos(blob2);
            file.ReadFormulas();
            si_callback(file);
         });
      });
   }

   JSROOT.TFile.prototype.ReadKeys = function(readkeys_callback) {
      // read keys only in the root file

      var file = this;

      // with the first readbuffer we read bigger amount to create header cache
      this.ReadBuffer(1024, function(blob) {
         if (blob==null) return JSROOT.CallBack(readkeys_callback, null);

         var buf = JSROOT.CreateTBuffer(blob, 0, file);

         if (buf.substring(0, 4)!='root') {
            alert("NOT A ROOT FILE! " + file.fURL);
            return JSROOT.CallBack(readkeys_callback, null);
         }
         buf.shift(4);

         file.fVersion = buf.ntou4();
         file.fBEGIN = buf.ntou4();
         if (file.fVersion < 1000000) { //small file
            file.fEND = buf.ntou4();
            file.fSeekFree = buf.ntou4();
            file.fNbytesFree = buf.ntou4();
            var nfree = buf.ntoi4();
            file.fNbytesName = buf.ntou4();
            file.fUnits = buf.ntou1();
            file.fCompress = buf.ntou4();
            file.fSeekInfo = buf.ntou4();
            file.fNbytesInfo = buf.ntou4();
         } else { // new format to support large files
            file.fEND = buf.ntou8();
            file.fSeekFree = buf.ntou8();
            file.fNbytesFree = buf.ntou4();
            var nfree = buf.ntou4();
            file.fNbytesName = buf.ntou4();
            file.fUnits = buf.ntou1();
            file.fCompress = buf.ntou4();
            file.fSeekInfo = buf.ntou8();
            file.fNbytesInfo = buf.ntou4();
         }

         // empty file
         if (!file.fSeekInfo && !file.fNbytesInfo)
            return JSROOT.CallBack(readkeys_callback, null);

         //*-*-------------Read directory info
         var nbytes = file.fNbytesName + 22;
         nbytes += 4;  // fDatimeC.Sizeof();
         nbytes += 4;  // fDatimeM.Sizeof();
         nbytes += 18; // fUUID.Sizeof();
         // assume that the file may be above 2 Gbytes if file version is > 4
         if (file.fVersion >= 40000) nbytes += 12;

         file.Seek(file.fBEGIN, file.ERelativeTo.kBeg);

         file.ReadBuffer(Math.max(300, nbytes), function(blob3) {
            if (blob3==null) return JSROOT.CallBack(readkeys_callback, null);

            var buf3 = JSROOT.CreateTBuffer(blob3, file.fNbytesName, file);

            // we call TDirectory method while TFile is just derived class
            JSROOT.TDirectory.prototype.StreamHeader.call(file, buf3);

            //*-*---------read TKey::FillBuffer info
            buf3.o = 4; // Skip NBytes;
            var keyversion = buf3.ntoi2();
            // Skip ObjLen, DateTime, KeyLen, Cycle, SeekKey, SeekPdir
            if (keyversion > 1000) buf3.shift(28); // Large files
                              else buf3.shift(20);
            buf3.ReadTString();
            buf3.ReadTString();
            file.fTitle = buf3.ReadTString();
            if (file.fNbytesName < 10 || this.fNbytesName > 10000) {
               JSROOT.console("Init : cannot read directory info of file " + file.fURL);
               return JSROOT.CallBack(readkeys_callback, null);
            }
            //*-* -------------Read keys of the top directory

            if (file.fSeekKeys <= 0) {
               JSROOT.console("Empty keys list - not supported" + file.fURL);
               return JSROOT.CallBack(readkeys_callback, null);
            }

            file.Seek(file.fSeekKeys, file.ERelativeTo.kBeg);
            file.ReadBuffer(file.fNbytesKeys, function(blob4) {

               if (blob4==null) return JSROOT.CallBack(readkeys_callback, null);

               var buf4 = JSROOT.CreateTBuffer(blob4, 0, file);
               var key = file.ReadKey(buf4);
               var nkeys = buf4.ntoi4();
               for (var i = 0; i < nkeys; ++i) {
                  key = file.ReadKey(buf4);
                  file.fKeys.push(key);
               }
               file.ReadStreamerInfos(readkeys_callback);
               delete buf4;
               delete blob4;
            });
            delete buf3;
            delete blob3;
         });
         delete buf;
         delete blob;
      });
   };

   JSROOT.TFile.prototype.ReadDirectory = function(dir_name, cycle, readdir_callback) {
      // read the directory content from  a root file
      // do not read directory if it is already exists

      return this.ReadObject(dir_name, cycle, readdir_callback);
   };

   JSROOT.TFile.prototype.GetStreamer = function(clname) {
      // return the streamer for the class 'clname', from the list of streamers
      // or generate it from the streamer infos and add it to the list

      var streamer = this.fStreamers[clname];
      if (typeof(streamer) != 'undefined') return streamer;

      var s_i = null;
      if (this.fStreamerInfos)
         for (var i=0; i < this.fStreamerInfos.arr.length; ++i)
            if (this.fStreamerInfos.arr[i].fName == clname)  {
               s_i = this.fStreamerInfos.arr[i]; break;
            }
      if (s_i == null) return null;

      this.fStreamers[clname] = streamer = new JSROOT.TStreamerInfo(this);

      if (typeof(s_i['fElements']) != 'undefined') {
         for (var j=0; j<s_i['fElements']['arr'].length; ++j) {
            // extract streamer info for each class member
            var element = s_i['fElements']['arr'][j];

            var member = {};
            member['typename'] = element['typename'];
            member['cntname']  = element['countName'];
            member['type']     = element['type'];
            member['length']   = element['length'];

            streamer[element['fName']] = member; // keep for backward compability

            if (element['typename'] === 'BASE') {
               this.GetStreamer(element['fName']);
               member['classname'] = element['fName'];
               streamer._base_classes.push(member);
            } else {
               member['name'] = element['fName'];
               streamer._class_members.push(member);
            }

         }
      }
      return streamer;
   };

   JSROOT.TFile.prototype.Delete = function() {
      if (this.fDirectories) this.fDirectories.splice(0, this.fDirectories.length);
      this.fDirectories = null;
      this.fKeys = null;
      this.fStreamers = null;
      this.fSeekInfo = 0;
      this.fNbytesInfo = 0;
      this.fTagOffset = 0;
   };

   (function() {
     var iomode = JSROOT.GetUrlOption("iomode");
     if ((iomode=="str") || (iomode=="string")) JSROOT.IO.Mode = "string"; else
     if ((iomode=="bin") || (iomode=="arr") || (iomode=="array")) JSROOT.IO.Mode = "array";
     JSROOT.IO.NativeArray = ('Float64Array' in window);
   })();

   return JSROOT;

}));


// JSRootIOEvolution.js ends

