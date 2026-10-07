-- Audit 2: additive publication integrity and compatible boolean presentation.
-- No historical definitions, option identities, answers, or membership boundaries are rewritten.

-- Generated from Unicode 15.1.0 CaseFolding.txt (C/F, non-Turkic). SHA256 4e55acfdc32825a22e87670e9056a3bf94ad7c5400065778e9e10f8314372bcf
-- Regenerate with node scripts/generate-option-casefold.mjs.
create or replace function private.metadata_option_label_key(label text) returns text
language plpgsql immutable strict set search_path='' as $function$
declare mapping constant jsonb := $mapping${"A":"a","B":"b","C":"c","D":"d","E":"e","F":"f","G":"g","H":"h","I":"i","J":"j","K":"k","L":"l","M":"m","N":"n","O":"o","P":"p","Q":"q","R":"r","S":"s","T":"t","U":"u","V":"v","W":"w","X":"x","Y":"y","Z":"z","µ":"μ","À":"à","Á":"á","Â":"â","Ã":"ã","Ä":"ä","Å":"å","Æ":"æ","Ç":"ç","È":"è","É":"é","Ê":"ê","Ë":"ë","Ì":"ì","Í":"í","Î":"î","Ï":"ï","Ð":"ð","Ñ":"ñ","Ò":"ò","Ó":"ó","Ô":"ô","Õ":"õ","Ö":"ö","Ø":"ø","Ù":"ù","Ú":"ú","Û":"û","Ü":"ü","Ý":"ý","Þ":"þ","ß":"ss","Ā":"ā","Ă":"ă","Ą":"ą","Ć":"ć","Ĉ":"ĉ","Ċ":"ċ","Č":"č","Ď":"ď","Đ":"đ","Ē":"ē","Ĕ":"ĕ","Ė":"ė","Ę":"ę","Ě":"ě","Ĝ":"ĝ","Ğ":"ğ","Ġ":"ġ","Ģ":"ģ","Ĥ":"ĥ","Ħ":"ħ","Ĩ":"ĩ","Ī":"ī","Ĭ":"ĭ","Į":"į","İ":"i̇","Ĳ":"ĳ","Ĵ":"ĵ","Ķ":"ķ","Ĺ":"ĺ","Ļ":"ļ","Ľ":"ľ","Ŀ":"ŀ","Ł":"ł","Ń":"ń","Ņ":"ņ","Ň":"ň","ŉ":"ʼn","Ŋ":"ŋ","Ō":"ō","Ŏ":"ŏ","Ő":"ő","Œ":"œ","Ŕ":"ŕ","Ŗ":"ŗ","Ř":"ř","Ś":"ś","Ŝ":"ŝ","Ş":"ş","Š":"š","Ţ":"ţ","Ť":"ť","Ŧ":"ŧ","Ũ":"ũ","Ū":"ū","Ŭ":"ŭ","Ů":"ů","Ű":"ű","Ų":"ų","Ŵ":"ŵ","Ŷ":"ŷ","Ÿ":"ÿ","Ź":"ź","Ż":"ż","Ž":"ž","ſ":"s","Ɓ":"ɓ","Ƃ":"ƃ","Ƅ":"ƅ","Ɔ":"ɔ","Ƈ":"ƈ","Ɖ":"ɖ","Ɗ":"ɗ","Ƌ":"ƌ","Ǝ":"ǝ","Ə":"ə","Ɛ":"ɛ","Ƒ":"ƒ","Ɠ":"ɠ","Ɣ":"ɣ","Ɩ":"ɩ","Ɨ":"ɨ","Ƙ":"ƙ","Ɯ":"ɯ","Ɲ":"ɲ","Ɵ":"ɵ","Ơ":"ơ","Ƣ":"ƣ","Ƥ":"ƥ","Ʀ":"ʀ","Ƨ":"ƨ","Ʃ":"ʃ","Ƭ":"ƭ","Ʈ":"ʈ","Ư":"ư","Ʊ":"ʊ","Ʋ":"ʋ","Ƴ":"ƴ","Ƶ":"ƶ","Ʒ":"ʒ","Ƹ":"ƹ","Ƽ":"ƽ","Ǆ":"ǆ","ǅ":"ǆ","Ǉ":"ǉ","ǈ":"ǉ","Ǌ":"ǌ","ǋ":"ǌ","Ǎ":"ǎ","Ǐ":"ǐ","Ǒ":"ǒ","Ǔ":"ǔ","Ǖ":"ǖ","Ǘ":"ǘ","Ǚ":"ǚ","Ǜ":"ǜ","Ǟ":"ǟ","Ǡ":"ǡ","Ǣ":"ǣ","Ǥ":"ǥ","Ǧ":"ǧ","Ǩ":"ǩ","Ǫ":"ǫ","Ǭ":"ǭ","Ǯ":"ǯ","ǰ":"ǰ","Ǳ":"ǳ","ǲ":"ǳ","Ǵ":"ǵ","Ƕ":"ƕ","Ƿ":"ƿ","Ǹ":"ǹ","Ǻ":"ǻ","Ǽ":"ǽ","Ǿ":"ǿ","Ȁ":"ȁ","Ȃ":"ȃ","Ȅ":"ȅ","Ȇ":"ȇ","Ȉ":"ȉ","Ȋ":"ȋ","Ȍ":"ȍ","Ȏ":"ȏ","Ȑ":"ȑ","Ȓ":"ȓ","Ȕ":"ȕ","Ȗ":"ȗ","Ș":"ș","Ț":"ț","Ȝ":"ȝ","Ȟ":"ȟ","Ƞ":"ƞ","Ȣ":"ȣ","Ȥ":"ȥ","Ȧ":"ȧ","Ȩ":"ȩ","Ȫ":"ȫ","Ȭ":"ȭ","Ȯ":"ȯ","Ȱ":"ȱ","Ȳ":"ȳ","Ⱥ":"ⱥ","Ȼ":"ȼ","Ƚ":"ƚ","Ⱦ":"ⱦ","Ɂ":"ɂ","Ƀ":"ƀ","Ʉ":"ʉ","Ʌ":"ʌ","Ɇ":"ɇ","Ɉ":"ɉ","Ɋ":"ɋ","Ɍ":"ɍ","Ɏ":"ɏ","ͅ":"ι","Ͱ":"ͱ","Ͳ":"ͳ","Ͷ":"ͷ","Ϳ":"ϳ","Ά":"ά","Έ":"έ","Ή":"ή","Ί":"ί","Ό":"ό","Ύ":"ύ","Ώ":"ώ","ΐ":"ΐ","Α":"α","Β":"β","Γ":"γ","Δ":"δ","Ε":"ε","Ζ":"ζ","Η":"η","Θ":"θ","Ι":"ι","Κ":"κ","Λ":"λ","Μ":"μ","Ν":"ν","Ξ":"ξ","Ο":"ο","Π":"π","Ρ":"ρ","Σ":"σ","Τ":"τ","Υ":"υ","Φ":"φ","Χ":"χ","Ψ":"ψ","Ω":"ω","Ϊ":"ϊ","Ϋ":"ϋ","ΰ":"ΰ","ς":"σ","Ϗ":"ϗ","ϐ":"β","ϑ":"θ","ϕ":"φ","ϖ":"π","Ϙ":"ϙ","Ϛ":"ϛ","Ϝ":"ϝ","Ϟ":"ϟ","Ϡ":"ϡ","Ϣ":"ϣ","Ϥ":"ϥ","Ϧ":"ϧ","Ϩ":"ϩ","Ϫ":"ϫ","Ϭ":"ϭ","Ϯ":"ϯ","ϰ":"κ","ϱ":"ρ","ϴ":"θ","ϵ":"ε","Ϸ":"ϸ","Ϲ":"ϲ","Ϻ":"ϻ","Ͻ":"ͻ","Ͼ":"ͼ","Ͽ":"ͽ","Ѐ":"ѐ","Ё":"ё","Ђ":"ђ","Ѓ":"ѓ","Є":"є","Ѕ":"ѕ","І":"і","Ї":"ї","Ј":"ј","Љ":"љ","Њ":"њ","Ћ":"ћ","Ќ":"ќ","Ѝ":"ѝ","Ў":"ў","Џ":"џ","А":"а","Б":"б","В":"в","Г":"г","Д":"д","Е":"е","Ж":"ж","З":"з","И":"и","Й":"й","К":"к","Л":"л","М":"м","Н":"н","О":"о","П":"п","Р":"р","С":"с","Т":"т","У":"у","Ф":"ф","Х":"х","Ц":"ц","Ч":"ч","Ш":"ш","Щ":"щ","Ъ":"ъ","Ы":"ы","Ь":"ь","Э":"э","Ю":"ю","Я":"я","Ѡ":"ѡ","Ѣ":"ѣ","Ѥ":"ѥ","Ѧ":"ѧ","Ѩ":"ѩ","Ѫ":"ѫ","Ѭ":"ѭ","Ѯ":"ѯ","Ѱ":"ѱ","Ѳ":"ѳ","Ѵ":"ѵ","Ѷ":"ѷ","Ѹ":"ѹ","Ѻ":"ѻ","Ѽ":"ѽ","Ѿ":"ѿ","Ҁ":"ҁ","Ҋ":"ҋ","Ҍ":"ҍ","Ҏ":"ҏ","Ґ":"ґ","Ғ":"ғ","Ҕ":"ҕ","Җ":"җ","Ҙ":"ҙ","Қ":"қ","Ҝ":"ҝ","Ҟ":"ҟ","Ҡ":"ҡ","Ң":"ң","Ҥ":"ҥ","Ҧ":"ҧ","Ҩ":"ҩ","Ҫ":"ҫ","Ҭ":"ҭ","Ү":"ү","Ұ":"ұ","Ҳ":"ҳ","Ҵ":"ҵ","Ҷ":"ҷ","Ҹ":"ҹ","Һ":"һ","Ҽ":"ҽ","Ҿ":"ҿ","Ӏ":"ӏ","Ӂ":"ӂ","Ӄ":"ӄ","Ӆ":"ӆ","Ӈ":"ӈ","Ӊ":"ӊ","Ӌ":"ӌ","Ӎ":"ӎ","Ӑ":"ӑ","Ӓ":"ӓ","Ӕ":"ӕ","Ӗ":"ӗ","Ә":"ә","Ӛ":"ӛ","Ӝ":"ӝ","Ӟ":"ӟ","Ӡ":"ӡ","Ӣ":"ӣ","Ӥ":"ӥ","Ӧ":"ӧ","Ө":"ө","Ӫ":"ӫ","Ӭ":"ӭ","Ӯ":"ӯ","Ӱ":"ӱ","Ӳ":"ӳ","Ӵ":"ӵ","Ӷ":"ӷ","Ӹ":"ӹ","Ӻ":"ӻ","Ӽ":"ӽ","Ӿ":"ӿ","Ԁ":"ԁ","Ԃ":"ԃ","Ԅ":"ԅ","Ԇ":"ԇ","Ԉ":"ԉ","Ԋ":"ԋ","Ԍ":"ԍ","Ԏ":"ԏ","Ԑ":"ԑ","Ԓ":"ԓ","Ԕ":"ԕ","Ԗ":"ԗ","Ԙ":"ԙ","Ԛ":"ԛ","Ԝ":"ԝ","Ԟ":"ԟ","Ԡ":"ԡ","Ԣ":"ԣ","Ԥ":"ԥ","Ԧ":"ԧ","Ԩ":"ԩ","Ԫ":"ԫ","Ԭ":"ԭ","Ԯ":"ԯ","Ա":"ա","Բ":"բ","Գ":"գ","Դ":"դ","Ե":"ե","Զ":"զ","Է":"է","Ը":"ը","Թ":"թ","Ժ":"ժ","Ի":"ի","Լ":"լ","Խ":"խ","Ծ":"ծ","Կ":"կ","Հ":"հ","Ձ":"ձ","Ղ":"ղ","Ճ":"ճ","Մ":"մ","Յ":"յ","Ն":"ն","Շ":"շ","Ո":"ո","Չ":"չ","Պ":"պ","Ջ":"ջ","Ռ":"ռ","Ս":"ս","Վ":"վ","Տ":"տ","Ր":"ր","Ց":"ց","Ւ":"ւ","Փ":"փ","Ք":"ք","Օ":"օ","Ֆ":"ֆ","և":"եւ","Ⴀ":"ⴀ","Ⴁ":"ⴁ","Ⴂ":"ⴂ","Ⴃ":"ⴃ","Ⴄ":"ⴄ","Ⴅ":"ⴅ","Ⴆ":"ⴆ","Ⴇ":"ⴇ","Ⴈ":"ⴈ","Ⴉ":"ⴉ","Ⴊ":"ⴊ","Ⴋ":"ⴋ","Ⴌ":"ⴌ","Ⴍ":"ⴍ","Ⴎ":"ⴎ","Ⴏ":"ⴏ","Ⴐ":"ⴐ","Ⴑ":"ⴑ","Ⴒ":"ⴒ","Ⴓ":"ⴓ","Ⴔ":"ⴔ","Ⴕ":"ⴕ","Ⴖ":"ⴖ","Ⴗ":"ⴗ","Ⴘ":"ⴘ","Ⴙ":"ⴙ","Ⴚ":"ⴚ","Ⴛ":"ⴛ","Ⴜ":"ⴜ","Ⴝ":"ⴝ","Ⴞ":"ⴞ","Ⴟ":"ⴟ","Ⴠ":"ⴠ","Ⴡ":"ⴡ","Ⴢ":"ⴢ","Ⴣ":"ⴣ","Ⴤ":"ⴤ","Ⴥ":"ⴥ","Ⴧ":"ⴧ","Ⴭ":"ⴭ","ᏸ":"Ᏸ","ᏹ":"Ᏹ","ᏺ":"Ᏺ","ᏻ":"Ᏻ","ᏼ":"Ᏼ","ᏽ":"Ᏽ","ᲀ":"в","ᲁ":"д","ᲂ":"о","ᲃ":"с","ᲄ":"т","ᲅ":"т","ᲆ":"ъ","ᲇ":"ѣ","ᲈ":"ꙋ","Ა":"ა","Ბ":"ბ","Გ":"გ","Დ":"დ","Ე":"ე","Ვ":"ვ","Ზ":"ზ","Თ":"თ","Ი":"ი","Კ":"კ","Ლ":"ლ","Მ":"მ","Ნ":"ნ","Ო":"ო","Პ":"პ","Ჟ":"ჟ","Რ":"რ","Ს":"ს","Ტ":"ტ","Უ":"უ","Ფ":"ფ","Ქ":"ქ","Ღ":"ღ","Ყ":"ყ","Შ":"შ","Ჩ":"ჩ","Ც":"ც","Ძ":"ძ","Წ":"წ","Ჭ":"ჭ","Ხ":"ხ","Ჯ":"ჯ","Ჰ":"ჰ","Ჱ":"ჱ","Ჲ":"ჲ","Ჳ":"ჳ","Ჴ":"ჴ","Ჵ":"ჵ","Ჶ":"ჶ","Ჷ":"ჷ","Ჸ":"ჸ","Ჹ":"ჹ","Ჺ":"ჺ","Ჽ":"ჽ","Ჾ":"ჾ","Ჿ":"ჿ","Ḁ":"ḁ","Ḃ":"ḃ","Ḅ":"ḅ","Ḇ":"ḇ","Ḉ":"ḉ","Ḋ":"ḋ","Ḍ":"ḍ","Ḏ":"ḏ","Ḑ":"ḑ","Ḓ":"ḓ","Ḕ":"ḕ","Ḗ":"ḗ","Ḙ":"ḙ","Ḛ":"ḛ","Ḝ":"ḝ","Ḟ":"ḟ","Ḡ":"ḡ","Ḣ":"ḣ","Ḥ":"ḥ","Ḧ":"ḧ","Ḩ":"ḩ","Ḫ":"ḫ","Ḭ":"ḭ","Ḯ":"ḯ","Ḱ":"ḱ","Ḳ":"ḳ","Ḵ":"ḵ","Ḷ":"ḷ","Ḹ":"ḹ","Ḻ":"ḻ","Ḽ":"ḽ","Ḿ":"ḿ","Ṁ":"ṁ","Ṃ":"ṃ","Ṅ":"ṅ","Ṇ":"ṇ","Ṉ":"ṉ","Ṋ":"ṋ","Ṍ":"ṍ","Ṏ":"ṏ","Ṑ":"ṑ","Ṓ":"ṓ","Ṕ":"ṕ","Ṗ":"ṗ","Ṙ":"ṙ","Ṛ":"ṛ","Ṝ":"ṝ","Ṟ":"ṟ","Ṡ":"ṡ","Ṣ":"ṣ","Ṥ":"ṥ","Ṧ":"ṧ","Ṩ":"ṩ","Ṫ":"ṫ","Ṭ":"ṭ","Ṯ":"ṯ","Ṱ":"ṱ","Ṳ":"ṳ","Ṵ":"ṵ","Ṷ":"ṷ","Ṹ":"ṹ","Ṻ":"ṻ","Ṽ":"ṽ","Ṿ":"ṿ","Ẁ":"ẁ","Ẃ":"ẃ","Ẅ":"ẅ","Ẇ":"ẇ","Ẉ":"ẉ","Ẋ":"ẋ","Ẍ":"ẍ","Ẏ":"ẏ","Ẑ":"ẑ","Ẓ":"ẓ","Ẕ":"ẕ","ẖ":"ẖ","ẗ":"ẗ","ẘ":"ẘ","ẙ":"ẙ","ẚ":"aʾ","ẛ":"ṡ","ẞ":"ss","Ạ":"ạ","Ả":"ả","Ấ":"ấ","Ầ":"ầ","Ẩ":"ẩ","Ẫ":"ẫ","Ậ":"ậ","Ắ":"ắ","Ằ":"ằ","Ẳ":"ẳ","Ẵ":"ẵ","Ặ":"ặ","Ẹ":"ẹ","Ẻ":"ẻ","Ẽ":"ẽ","Ế":"ế","Ề":"ề","Ể":"ể","Ễ":"ễ","Ệ":"ệ","Ỉ":"ỉ","Ị":"ị","Ọ":"ọ","Ỏ":"ỏ","Ố":"ố","Ồ":"ồ","Ổ":"ổ","Ỗ":"ỗ","Ộ":"ộ","Ớ":"ớ","Ờ":"ờ","Ở":"ở","Ỡ":"ỡ","Ợ":"ợ","Ụ":"ụ","Ủ":"ủ","Ứ":"ứ","Ừ":"ừ","Ử":"ử","Ữ":"ữ","Ự":"ự","Ỳ":"ỳ","Ỵ":"ỵ","Ỷ":"ỷ","Ỹ":"ỹ","Ỻ":"ỻ","Ỽ":"ỽ","Ỿ":"ỿ","Ἀ":"ἀ","Ἁ":"ἁ","Ἂ":"ἂ","Ἃ":"ἃ","Ἄ":"ἄ","Ἅ":"ἅ","Ἆ":"ἆ","Ἇ":"ἇ","Ἐ":"ἐ","Ἑ":"ἑ","Ἒ":"ἒ","Ἓ":"ἓ","Ἔ":"ἔ","Ἕ":"ἕ","Ἠ":"ἠ","Ἡ":"ἡ","Ἢ":"ἢ","Ἣ":"ἣ","Ἤ":"ἤ","Ἥ":"ἥ","Ἦ":"ἦ","Ἧ":"ἧ","Ἰ":"ἰ","Ἱ":"ἱ","Ἲ":"ἲ","Ἳ":"ἳ","Ἴ":"ἴ","Ἵ":"ἵ","Ἶ":"ἶ","Ἷ":"ἷ","Ὀ":"ὀ","Ὁ":"ὁ","Ὂ":"ὂ","Ὃ":"ὃ","Ὄ":"ὄ","Ὅ":"ὅ","ὐ":"ὐ","ὒ":"ὒ","ὔ":"ὔ","ὖ":"ὖ","Ὑ":"ὑ","Ὓ":"ὓ","Ὕ":"ὕ","Ὗ":"ὗ","Ὠ":"ὠ","Ὡ":"ὡ","Ὢ":"ὢ","Ὣ":"ὣ","Ὤ":"ὤ","Ὥ":"ὥ","Ὦ":"ὦ","Ὧ":"ὧ","ᾀ":"ἀι","ᾁ":"ἁι","ᾂ":"ἂι","ᾃ":"ἃι","ᾄ":"ἄι","ᾅ":"ἅι","ᾆ":"ἆι","ᾇ":"ἇι","ᾈ":"ἀι","ᾉ":"ἁι","ᾊ":"ἂι","ᾋ":"ἃι","ᾌ":"ἄι","ᾍ":"ἅι","ᾎ":"ἆι","ᾏ":"ἇι","ᾐ":"ἠι","ᾑ":"ἡι","ᾒ":"ἢι","ᾓ":"ἣι","ᾔ":"ἤι","ᾕ":"ἥι","ᾖ":"ἦι","ᾗ":"ἧι","ᾘ":"ἠι","ᾙ":"ἡι","ᾚ":"ἢι","ᾛ":"ἣι","ᾜ":"ἤι","ᾝ":"ἥι","ᾞ":"ἦι","ᾟ":"ἧι","ᾠ":"ὠι","ᾡ":"ὡι","ᾢ":"ὢι","ᾣ":"ὣι","ᾤ":"ὤι","ᾥ":"ὥι","ᾦ":"ὦι","ᾧ":"ὧι","ᾨ":"ὠι","ᾩ":"ὡι","ᾪ":"ὢι","ᾫ":"ὣι","ᾬ":"ὤι","ᾭ":"ὥι","ᾮ":"ὦι","ᾯ":"ὧι","ᾲ":"ὰι","ᾳ":"αι","ᾴ":"άι","ᾶ":"ᾶ","ᾷ":"ᾶι","Ᾰ":"ᾰ","Ᾱ":"ᾱ","Ὰ":"ὰ","Ά":"ά","ᾼ":"αι","ι":"ι","ῂ":"ὴι","ῃ":"ηι","ῄ":"ήι","ῆ":"ῆ","ῇ":"ῆι","Ὲ":"ὲ","Έ":"έ","Ὴ":"ὴ","Ή":"ή","ῌ":"ηι","ῒ":"ῒ","ΐ":"ΐ","ῖ":"ῖ","ῗ":"ῗ","Ῐ":"ῐ","Ῑ":"ῑ","Ὶ":"ὶ","Ί":"ί","ῢ":"ῢ","ΰ":"ΰ","ῤ":"ῤ","ῦ":"ῦ","ῧ":"ῧ","Ῠ":"ῠ","Ῡ":"ῡ","Ὺ":"ὺ","Ύ":"ύ","Ῥ":"ῥ","ῲ":"ὼι","ῳ":"ωι","ῴ":"ώι","ῶ":"ῶ","ῷ":"ῶι","Ὸ":"ὸ","Ό":"ό","Ὼ":"ὼ","Ώ":"ώ","ῼ":"ωι","Ω":"ω","K":"k","Å":"å","Ⅎ":"ⅎ","Ⅰ":"ⅰ","Ⅱ":"ⅱ","Ⅲ":"ⅲ","Ⅳ":"ⅳ","Ⅴ":"ⅴ","Ⅵ":"ⅵ","Ⅶ":"ⅶ","Ⅷ":"ⅷ","Ⅸ":"ⅸ","Ⅹ":"ⅹ","Ⅺ":"ⅺ","Ⅻ":"ⅻ","Ⅼ":"ⅼ","Ⅽ":"ⅽ","Ⅾ":"ⅾ","Ⅿ":"ⅿ","Ↄ":"ↄ","Ⓐ":"ⓐ","Ⓑ":"ⓑ","Ⓒ":"ⓒ","Ⓓ":"ⓓ","Ⓔ":"ⓔ","Ⓕ":"ⓕ","Ⓖ":"ⓖ","Ⓗ":"ⓗ","Ⓘ":"ⓘ","Ⓙ":"ⓙ","Ⓚ":"ⓚ","Ⓛ":"ⓛ","Ⓜ":"ⓜ","Ⓝ":"ⓝ","Ⓞ":"ⓞ","Ⓟ":"ⓟ","Ⓠ":"ⓠ","Ⓡ":"ⓡ","Ⓢ":"ⓢ","Ⓣ":"ⓣ","Ⓤ":"ⓤ","Ⓥ":"ⓥ","Ⓦ":"ⓦ","Ⓧ":"ⓧ","Ⓨ":"ⓨ","Ⓩ":"ⓩ","Ⰰ":"ⰰ","Ⰱ":"ⰱ","Ⰲ":"ⰲ","Ⰳ":"ⰳ","Ⰴ":"ⰴ","Ⰵ":"ⰵ","Ⰶ":"ⰶ","Ⰷ":"ⰷ","Ⰸ":"ⰸ","Ⰹ":"ⰹ","Ⰺ":"ⰺ","Ⰻ":"ⰻ","Ⰼ":"ⰼ","Ⰽ":"ⰽ","Ⰾ":"ⰾ","Ⰿ":"ⰿ","Ⱀ":"ⱀ","Ⱁ":"ⱁ","Ⱂ":"ⱂ","Ⱃ":"ⱃ","Ⱄ":"ⱄ","Ⱅ":"ⱅ","Ⱆ":"ⱆ","Ⱇ":"ⱇ","Ⱈ":"ⱈ","Ⱉ":"ⱉ","Ⱊ":"ⱊ","Ⱋ":"ⱋ","Ⱌ":"ⱌ","Ⱍ":"ⱍ","Ⱎ":"ⱎ","Ⱏ":"ⱏ","Ⱐ":"ⱐ","Ⱑ":"ⱑ","Ⱒ":"ⱒ","Ⱓ":"ⱓ","Ⱔ":"ⱔ","Ⱕ":"ⱕ","Ⱖ":"ⱖ","Ⱗ":"ⱗ","Ⱘ":"ⱘ","Ⱙ":"ⱙ","Ⱚ":"ⱚ","Ⱛ":"ⱛ","Ⱜ":"ⱜ","Ⱝ":"ⱝ","Ⱞ":"ⱞ","Ⱟ":"ⱟ","Ⱡ":"ⱡ","Ɫ":"ɫ","Ᵽ":"ᵽ","Ɽ":"ɽ","Ⱨ":"ⱨ","Ⱪ":"ⱪ","Ⱬ":"ⱬ","Ɑ":"ɑ","Ɱ":"ɱ","Ɐ":"ɐ","Ɒ":"ɒ","Ⱳ":"ⱳ","Ⱶ":"ⱶ","Ȿ":"ȿ","Ɀ":"ɀ","Ⲁ":"ⲁ","Ⲃ":"ⲃ","Ⲅ":"ⲅ","Ⲇ":"ⲇ","Ⲉ":"ⲉ","Ⲋ":"ⲋ","Ⲍ":"ⲍ","Ⲏ":"ⲏ","Ⲑ":"ⲑ","Ⲓ":"ⲓ","Ⲕ":"ⲕ","Ⲗ":"ⲗ","Ⲙ":"ⲙ","Ⲛ":"ⲛ","Ⲝ":"ⲝ","Ⲟ":"ⲟ","Ⲡ":"ⲡ","Ⲣ":"ⲣ","Ⲥ":"ⲥ","Ⲧ":"ⲧ","Ⲩ":"ⲩ","Ⲫ":"ⲫ","Ⲭ":"ⲭ","Ⲯ":"ⲯ","Ⲱ":"ⲱ","Ⲳ":"ⲳ","Ⲵ":"ⲵ","Ⲷ":"ⲷ","Ⲹ":"ⲹ","Ⲻ":"ⲻ","Ⲽ":"ⲽ","Ⲿ":"ⲿ","Ⳁ":"ⳁ","Ⳃ":"ⳃ","Ⳅ":"ⳅ","Ⳇ":"ⳇ","Ⳉ":"ⳉ","Ⳋ":"ⳋ","Ⳍ":"ⳍ","Ⳏ":"ⳏ","Ⳑ":"ⳑ","Ⳓ":"ⳓ","Ⳕ":"ⳕ","Ⳗ":"ⳗ","Ⳙ":"ⳙ","Ⳛ":"ⳛ","Ⳝ":"ⳝ","Ⳟ":"ⳟ","Ⳡ":"ⳡ","Ⳣ":"ⳣ","Ⳬ":"ⳬ","Ⳮ":"ⳮ","Ⳳ":"ⳳ","Ꙁ":"ꙁ","Ꙃ":"ꙃ","Ꙅ":"ꙅ","Ꙇ":"ꙇ","Ꙉ":"ꙉ","Ꙋ":"ꙋ","Ꙍ":"ꙍ","Ꙏ":"ꙏ","Ꙑ":"ꙑ","Ꙓ":"ꙓ","Ꙕ":"ꙕ","Ꙗ":"ꙗ","Ꙙ":"ꙙ","Ꙛ":"ꙛ","Ꙝ":"ꙝ","Ꙟ":"ꙟ","Ꙡ":"ꙡ","Ꙣ":"ꙣ","Ꙥ":"ꙥ","Ꙧ":"ꙧ","Ꙩ":"ꙩ","Ꙫ":"ꙫ","Ꙭ":"ꙭ","Ꚁ":"ꚁ","Ꚃ":"ꚃ","Ꚅ":"ꚅ","Ꚇ":"ꚇ","Ꚉ":"ꚉ","Ꚋ":"ꚋ","Ꚍ":"ꚍ","Ꚏ":"ꚏ","Ꚑ":"ꚑ","Ꚓ":"ꚓ","Ꚕ":"ꚕ","Ꚗ":"ꚗ","Ꚙ":"ꚙ","Ꚛ":"ꚛ","Ꜣ":"ꜣ","Ꜥ":"ꜥ","Ꜧ":"ꜧ","Ꜩ":"ꜩ","Ꜫ":"ꜫ","Ꜭ":"ꜭ","Ꜯ":"ꜯ","Ꜳ":"ꜳ","Ꜵ":"ꜵ","Ꜷ":"ꜷ","Ꜹ":"ꜹ","Ꜻ":"ꜻ","Ꜽ":"ꜽ","Ꜿ":"ꜿ","Ꝁ":"ꝁ","Ꝃ":"ꝃ","Ꝅ":"ꝅ","Ꝇ":"ꝇ","Ꝉ":"ꝉ","Ꝋ":"ꝋ","Ꝍ":"ꝍ","Ꝏ":"ꝏ","Ꝑ":"ꝑ","Ꝓ":"ꝓ","Ꝕ":"ꝕ","Ꝗ":"ꝗ","Ꝙ":"ꝙ","Ꝛ":"ꝛ","Ꝝ":"ꝝ","Ꝟ":"ꝟ","Ꝡ":"ꝡ","Ꝣ":"ꝣ","Ꝥ":"ꝥ","Ꝧ":"ꝧ","Ꝩ":"ꝩ","Ꝫ":"ꝫ","Ꝭ":"ꝭ","Ꝯ":"ꝯ","Ꝺ":"ꝺ","Ꝼ":"ꝼ","Ᵹ":"ᵹ","Ꝿ":"ꝿ","Ꞁ":"ꞁ","Ꞃ":"ꞃ","Ꞅ":"ꞅ","Ꞇ":"ꞇ","Ꞌ":"ꞌ","Ɥ":"ɥ","Ꞑ":"ꞑ","Ꞓ":"ꞓ","Ꞗ":"ꞗ","Ꞙ":"ꞙ","Ꞛ":"ꞛ","Ꞝ":"ꞝ","Ꞟ":"ꞟ","Ꞡ":"ꞡ","Ꞣ":"ꞣ","Ꞥ":"ꞥ","Ꞧ":"ꞧ","Ꞩ":"ꞩ","Ɦ":"ɦ","Ɜ":"ɜ","Ɡ":"ɡ","Ɬ":"ɬ","Ɪ":"ɪ","Ʞ":"ʞ","Ʇ":"ʇ","Ʝ":"ʝ","Ꭓ":"ꭓ","Ꞵ":"ꞵ","Ꞷ":"ꞷ","Ꞹ":"ꞹ","Ꞻ":"ꞻ","Ꞽ":"ꞽ","Ꞿ":"ꞿ","Ꟁ":"ꟁ","Ꟃ":"ꟃ","Ꞔ":"ꞔ","Ʂ":"ʂ","Ᶎ":"ᶎ","Ꟈ":"ꟈ","Ꟊ":"ꟊ","Ꟑ":"ꟑ","Ꟗ":"ꟗ","Ꟙ":"ꟙ","Ꟶ":"ꟶ","ꭰ":"Ꭰ","ꭱ":"Ꭱ","ꭲ":"Ꭲ","ꭳ":"Ꭳ","ꭴ":"Ꭴ","ꭵ":"Ꭵ","ꭶ":"Ꭶ","ꭷ":"Ꭷ","ꭸ":"Ꭸ","ꭹ":"Ꭹ","ꭺ":"Ꭺ","ꭻ":"Ꭻ","ꭼ":"Ꭼ","ꭽ":"Ꭽ","ꭾ":"Ꭾ","ꭿ":"Ꭿ","ꮀ":"Ꮀ","ꮁ":"Ꮁ","ꮂ":"Ꮂ","ꮃ":"Ꮃ","ꮄ":"Ꮄ","ꮅ":"Ꮅ","ꮆ":"Ꮆ","ꮇ":"Ꮇ","ꮈ":"Ꮈ","ꮉ":"Ꮉ","ꮊ":"Ꮊ","ꮋ":"Ꮋ","ꮌ":"Ꮌ","ꮍ":"Ꮍ","ꮎ":"Ꮎ","ꮏ":"Ꮏ","ꮐ":"Ꮐ","ꮑ":"Ꮑ","ꮒ":"Ꮒ","ꮓ":"Ꮓ","ꮔ":"Ꮔ","ꮕ":"Ꮕ","ꮖ":"Ꮖ","ꮗ":"Ꮗ","ꮘ":"Ꮘ","ꮙ":"Ꮙ","ꮚ":"Ꮚ","ꮛ":"Ꮛ","ꮜ":"Ꮜ","ꮝ":"Ꮝ","ꮞ":"Ꮞ","ꮟ":"Ꮟ","ꮠ":"Ꮠ","ꮡ":"Ꮡ","ꮢ":"Ꮢ","ꮣ":"Ꮣ","ꮤ":"Ꮤ","ꮥ":"Ꮥ","ꮦ":"Ꮦ","ꮧ":"Ꮧ","ꮨ":"Ꮨ","ꮩ":"Ꮩ","ꮪ":"Ꮪ","ꮫ":"Ꮫ","ꮬ":"Ꮬ","ꮭ":"Ꮭ","ꮮ":"Ꮮ","ꮯ":"Ꮯ","ꮰ":"Ꮰ","ꮱ":"Ꮱ","ꮲ":"Ꮲ","ꮳ":"Ꮳ","ꮴ":"Ꮴ","ꮵ":"Ꮵ","ꮶ":"Ꮶ","ꮷ":"Ꮷ","ꮸ":"Ꮸ","ꮹ":"Ꮹ","ꮺ":"Ꮺ","ꮻ":"Ꮻ","ꮼ":"Ꮼ","ꮽ":"Ꮽ","ꮾ":"Ꮾ","ꮿ":"Ꮿ","ﬀ":"ff","ﬁ":"fi","ﬂ":"fl","ﬃ":"ffi","ﬄ":"ffl","ﬅ":"st","ﬆ":"st","ﬓ":"մն","ﬔ":"մե","ﬕ":"մի","ﬖ":"վն","ﬗ":"մխ","Ａ":"ａ","Ｂ":"ｂ","Ｃ":"ｃ","Ｄ":"ｄ","Ｅ":"ｅ","Ｆ":"ｆ","Ｇ":"ｇ","Ｈ":"ｈ","Ｉ":"ｉ","Ｊ":"ｊ","Ｋ":"ｋ","Ｌ":"ｌ","Ｍ":"ｍ","Ｎ":"ｎ","Ｏ":"ｏ","Ｐ":"ｐ","Ｑ":"ｑ","Ｒ":"ｒ","Ｓ":"ｓ","Ｔ":"ｔ","Ｕ":"ｕ","Ｖ":"ｖ","Ｗ":"ｗ","Ｘ":"ｘ","Ｙ":"ｙ","Ｚ":"ｚ","𐐀":"𐐨","𐐁":"𐐩","𐐂":"𐐪","𐐃":"𐐫","𐐄":"𐐬","𐐅":"𐐭","𐐆":"𐐮","𐐇":"𐐯","𐐈":"𐐰","𐐉":"𐐱","𐐊":"𐐲","𐐋":"𐐳","𐐌":"𐐴","𐐍":"𐐵","𐐎":"𐐶","𐐏":"𐐷","𐐐":"𐐸","𐐑":"𐐹","𐐒":"𐐺","𐐓":"𐐻","𐐔":"𐐼","𐐕":"𐐽","𐐖":"𐐾","𐐗":"𐐿","𐐘":"𐑀","𐐙":"𐑁","𐐚":"𐑂","𐐛":"𐑃","𐐜":"𐑄","𐐝":"𐑅","𐐞":"𐑆","𐐟":"𐑇","𐐠":"𐑈","𐐡":"𐑉","𐐢":"𐑊","𐐣":"𐑋","𐐤":"𐑌","𐐥":"𐑍","𐐦":"𐑎","𐐧":"𐑏","𐒰":"𐓘","𐒱":"𐓙","𐒲":"𐓚","𐒳":"𐓛","𐒴":"𐓜","𐒵":"𐓝","𐒶":"𐓞","𐒷":"𐓟","𐒸":"𐓠","𐒹":"𐓡","𐒺":"𐓢","𐒻":"𐓣","𐒼":"𐓤","𐒽":"𐓥","𐒾":"𐓦","𐒿":"𐓧","𐓀":"𐓨","𐓁":"𐓩","𐓂":"𐓪","𐓃":"𐓫","𐓄":"𐓬","𐓅":"𐓭","𐓆":"𐓮","𐓇":"𐓯","𐓈":"𐓰","𐓉":"𐓱","𐓊":"𐓲","𐓋":"𐓳","𐓌":"𐓴","𐓍":"𐓵","𐓎":"𐓶","𐓏":"𐓷","𐓐":"𐓸","𐓑":"𐓹","𐓒":"𐓺","𐓓":"𐓻","𐕰":"𐖗","𐕱":"𐖘","𐕲":"𐖙","𐕳":"𐖚","𐕴":"𐖛","𐕵":"𐖜","𐕶":"𐖝","𐕷":"𐖞","𐕸":"𐖟","𐕹":"𐖠","𐕺":"𐖡","𐕼":"𐖣","𐕽":"𐖤","𐕾":"𐖥","𐕿":"𐖦","𐖀":"𐖧","𐖁":"𐖨","𐖂":"𐖩","𐖃":"𐖪","𐖄":"𐖫","𐖅":"𐖬","𐖆":"𐖭","𐖇":"𐖮","𐖈":"𐖯","𐖉":"𐖰","𐖊":"𐖱","𐖌":"𐖳","𐖍":"𐖴","𐖎":"𐖵","𐖏":"𐖶","𐖐":"𐖷","𐖑":"𐖸","𐖒":"𐖹","𐖔":"𐖻","𐖕":"𐖼","𐲀":"𐳀","𐲁":"𐳁","𐲂":"𐳂","𐲃":"𐳃","𐲄":"𐳄","𐲅":"𐳅","𐲆":"𐳆","𐲇":"𐳇","𐲈":"𐳈","𐲉":"𐳉","𐲊":"𐳊","𐲋":"𐳋","𐲌":"𐳌","𐲍":"𐳍","𐲎":"𐳎","𐲏":"𐳏","𐲐":"𐳐","𐲑":"𐳑","𐲒":"𐳒","𐲓":"𐳓","𐲔":"𐳔","𐲕":"𐳕","𐲖":"𐳖","𐲗":"𐳗","𐲘":"𐳘","𐲙":"𐳙","𐲚":"𐳚","𐲛":"𐳛","𐲜":"𐳜","𐲝":"𐳝","𐲞":"𐳞","𐲟":"𐳟","𐲠":"𐳠","𐲡":"𐳡","𐲢":"𐳢","𐲣":"𐳣","𐲤":"𐳤","𐲥":"𐳥","𐲦":"𐳦","𐲧":"𐳧","𐲨":"𐳨","𐲩":"𐳩","𐲪":"𐳪","𐲫":"𐳫","𐲬":"𐳬","𐲭":"𐳭","𐲮":"𐳮","𐲯":"𐳯","𐲰":"𐳰","𐲱":"𐳱","𐲲":"𐳲","𑢠":"𑣀","𑢡":"𑣁","𑢢":"𑣂","𑢣":"𑣃","𑢤":"𑣄","𑢥":"𑣅","𑢦":"𑣆","𑢧":"𑣇","𑢨":"𑣈","𑢩":"𑣉","𑢪":"𑣊","𑢫":"𑣋","𑢬":"𑣌","𑢭":"𑣍","𑢮":"𑣎","𑢯":"𑣏","𑢰":"𑣐","𑢱":"𑣑","𑢲":"𑣒","𑢳":"𑣓","𑢴":"𑣔","𑢵":"𑣕","𑢶":"𑣖","𑢷":"𑣗","𑢸":"𑣘","𑢹":"𑣙","𑢺":"𑣚","𑢻":"𑣛","𑢼":"𑣜","𑢽":"𑣝","𑢾":"𑣞","𑢿":"𑣟","𖹀":"𖹠","𖹁":"𖹡","𖹂":"𖹢","𖹃":"𖹣","𖹄":"𖹤","𖹅":"𖹥","𖹆":"𖹦","𖹇":"𖹧","𖹈":"𖹨","𖹉":"𖹩","𖹊":"𖹪","𖹋":"𖹫","𖹌":"𖹬","𖹍":"𖹭","𖹎":"𖹮","𖹏":"𖹯","𖹐":"𖹰","𖹑":"𖹱","𖹒":"𖹲","𖹓":"𖹳","𖹔":"𖹴","𖹕":"𖹵","𖹖":"𖹶","𖹗":"𖹷","𖹘":"𖹸","𖹙":"𖹹","𖹚":"𖹺","𖹛":"𖹻","𖹜":"𖹼","𖹝":"𖹽","𖹞":"𖹾","𖹟":"𖹿","𞤀":"𞤢","𞤁":"𞤣","𞤂":"𞤤","𞤃":"𞤥","𞤄":"𞤦","𞤅":"𞤧","𞤆":"𞤨","𞤇":"𞤩","𞤈":"𞤪","𞤉":"𞤫","𞤊":"𞤬","𞤋":"𞤭","𞤌":"𞤮","𞤍":"𞤯","𞤎":"𞤰","𞤏":"𞤱","𞤐":"𞤲","𞤑":"𞤳","𞤒":"𞤴","𞤓":"𞤵","𞤔":"𞤶","𞤕":"𞤷","𞤖":"𞤸","𞤗":"𞤹","𞤘":"𞤺","𞤙":"𞤻","𞤚":"𞤼","𞤛":"𞤽","𞤜":"𞤾","𞤝":"𞤿","𞤞":"𞥀","𞤟":"𞥁","𞤠":"𞥂","𞤡":"𞥃"}$mapping$::jsonb;
  folded text := ''; point text; normalized text := normalize(label, NFC);
  whitespace constant text := chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(133)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
begin
  for point in select regexp_split_to_table(normalized, '') loop
    folded := folded || coalesce(mapping->>point, point);
  end loop;
  return normalize(btrim(regexp_replace(folded, '['||whitespace||']+', ' ', 'g'), ' '), NFC);
end;
$function$;
revoke all on function private.metadata_option_label_key(text) from public,anon,authenticated,service_role;

create or replace function private.metadata_validate_rules(kind text, rules jsonb) returns void
language plpgsql set search_path='' as $$
declare allowed text[]; key text; min_value numeric; max_value numeric; bound text;
  precision_value integer;
begin
  if rules is null or jsonb_typeof(rules)<>'object' then raise exception using errcode='P1021',message='invalid_form_rules'; end if;
  allowed:=case
    when kind in ('short_text','long_text') then array['minLength','maxLength']
    when kind in ('integer','decimal','currency') then array['min','max','precision','currencyCode']
    when kind in ('date','datetime') then array['min','max']
    when kind='multi_select' then array['maxSelections']
    when kind='boolean' then array['booleanPresentation']
    else array[]::text[] end;
  for key in select jsonb_object_keys(rules) loop
    if not key=any(allowed) then raise exception using errcode='P1021',message='unsupported_form_rule'; end if;
  end loop;
  if kind='boolean' and rules ? 'booleanPresentation' and
    (jsonb_typeof(rules->'booleanPresentation') is distinct from 'string' or
      rules->>'booleanPresentation' not in ('checkbox','yes_no')) then
    raise exception using errcode='P1021',message='invalid_boolean_presentation'; end if;
  if kind in ('short_text','long_text') then
    if exists(select 1 from jsonb_each(rules) x where x.value::text !~ '^[0-9]+$'
      or length(x.value::text)>5) then
      raise exception using errcode='P1021',message='invalid_form_rules'; end if;
    if coalesce((rules->>'minLength')::integer,0)>coalesce((rules->>'maxLength')::integer,
      case when kind='short_text' then 500 else 10000 end)
      or coalesce((rules->>'maxLength')::integer,0)>(case when kind='short_text' then 500 else 10000 end) then
      raise exception using errcode='P1021',message='invalid_form_rules'; end if;
  elsif kind in ('integer','decimal','currency') then
    if kind='integer' and (rules ? 'precision' or rules ? 'currencyCode') then
      raise exception using errcode='P1021',message='invalid_form_rules'; end if;
    if kind='decimal' and rules ? 'currencyCode' then raise exception using errcode='P1021',message='invalid_form_rules'; end if;
    if kind='currency' and not private.metadata_currency_code_valid(rules->>'currencyCode') then
      raise exception using errcode='P1021',message='invalid_currency'; end if;
    if rules ? 'precision' and (jsonb_typeof(rules->'precision') is distinct from 'number' or
      (rules->>'precision') !~ '^[0-9]$' or
      (rules->>'precision')::integer>case when kind='currency' then 4 else 6 end) then
      raise exception using errcode='P1021',message='invalid_precision'; end if;
    if kind='currency' and not rules ? 'precision' then raise exception using errcode='P1021',message='missing_currency_precision'; end if;
    if rules ? 'min' and not coalesce((rules->>'min') ~ '^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$',false) then
      raise exception using errcode='P1021',message='invalid_minimum'; end if;
    if rules ? 'max' and not coalesce((rules->>'max') ~ '^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$',false) then
      raise exception using errcode='P1021',message='invalid_maximum'; end if;
    precision_value:=coalesce((rules->>'precision')::integer,6);
    for bound in select value from (values(rules->>'min'),(rules->>'max')) x(value)
      where value is not null loop
      if length(regexp_replace(bound,'[^0-9]','','g'))>24 or
        length(split_part(bound,'.',2))>precision_value then
        raise exception using errcode='P1021',message='inconsistent_numeric_bounds'; end if;
    end loop;
    min_value:=(rules->>'min')::numeric; max_value:=(rules->>'max')::numeric;
    if min_value>max_value then raise exception using errcode='P1021',message='inverted_bounds'; end if;
    if kind='integer' and (min_value<>trunc(min_value) or max_value<>trunc(max_value)
      or abs(coalesce(min_value,0))>9007199254740991 or abs(coalesce(max_value,0))>9007199254740991) then
      raise exception using errcode='P1021',message='invalid_integer_bounds'; end if;
  elsif kind='multi_select' then
    if rules ? 'maxSelections' and (jsonb_typeof(rules->'maxSelections') is distinct from 'number'
      or (rules->>'maxSelections') !~ '^[1-9][0-9]{0,3}$'
      or (rules->>'maxSelections')::integer>1000) then raise exception using errcode='P1021',message='invalid_selection_limit'; end if;
  elsif kind in ('date','datetime') then
    if rules ? 'min' and not coalesce(private.metadata_date_bound_valid(kind,rules->>'min'),false) then
      raise exception using errcode='P1021',message='invalid_date_minimum'; end if;
    if rules ? 'max' and not coalesce(private.metadata_date_bound_valid(kind,rules->>'max'),false) then
      raise exception using errcode='P1021',message='invalid_date_maximum'; end if;
    if rules ? 'min' and rules ? 'max' and
      (case when kind='date' then (rules->>'min')::date>(rules->>'max')::date
        else (rules->>'min')::timestamptz>(rules->>'max')::timestamptz end) then
      raise exception using errcode='P1021',message='inverted_bounds'; end if;
  end if;
end;
$$;

create or replace function private.metadata_compile_form(rev uuid, category uuid, definition jsonb) returns void
language plpgsql set search_path='' as $$
declare f jsonb; o jsonb; s jsonb; c jsonb; field_uuid uuid; option_uuid uuid;
  parent_uuid uuid; section_uuid uuid; control_uuid uuid; kind text; ordinal integer;
  field_count integer; option_count integer:=0; row_count integer; bad_count integer;
begin
  if jsonb_typeof(definition) is distinct from 'object' then
    raise exception using errcode='P1021',message='invalid_form_shape'; end if;
  if not (definition ?& array['fields','layout']) or
    jsonb_typeof(definition->'fields') is distinct from 'array'
    or jsonb_typeof(definition->'layout') is distinct from 'array' or
    (select count(*) from jsonb_object_keys(definition))<>2 then
    raise exception using errcode='P1021',message='invalid_form_shape'; end if;
  field_count:=jsonb_array_length(definition->'fields');
  if field_count>100 or jsonb_array_length(definition->'layout')>100 then
    raise exception using errcode='P1022',message='form_resource_limit'; end if;
  ordinal:=0;
  for f in select value from jsonb_array_elements(definition->'fields') loop
    if jsonb_typeof(f) is distinct from 'object' or
      jsonb_typeof(f->'applies_to') is distinct from 'array' or
      (f ? 'options' and jsonb_typeof(f->'options') is distinct from 'array') then
      raise exception using errcode='P1021',message='invalid_field'; end if;
    if not (f ?& array['id','type','label','applies_to','required']) or
      exists(select 1 from jsonb_object_keys(f) k where k not in
        ('id','type','label','help','applies_to','required','default','rules','options')) or
      not coalesce((f->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
      or not coalesce((f->>'type') in ('short_text','long_text','integer','decimal','boolean','date','datetime','url',
        'currency','single_select','multi_select','hierarchical_select')
        ,false)
      or jsonb_typeof(f->'label') is distinct from 'string'
      or not coalesce(length(btrim(f->>'label')) between 1 and 200,false)
      or (f ? 'help' and f->'help'<>'null'::jsonb and
        (jsonb_typeof(f->'help')<>'string' or length(f->>'help')>2000))
      or not coalesce(jsonb_array_length(f->'applies_to') between 1 and 2,false)
      or jsonb_typeof(f->'required') is distinct from 'boolean'
      then
      raise exception using errcode='P1021',message='invalid_field'; end if;
    if exists(select 1 from jsonb_array_elements_text(f->'applies_to') x where x not in ('quantity','asset'))
      or (select count(distinct x) from jsonb_array_elements_text(f->'applies_to') x)<>
         jsonb_array_length(f->'applies_to') then
      raise exception using errcode='P1021',message='invalid_applicability'; end if;
    field_uuid:=(f->>'id')::uuid; kind:=f->>'type';
    if exists(select 1 from public.metadata_fields where id=field_uuid and
      (category_id<>category or field_type<>kind)) then
      raise exception using errcode='P1021',message='field_identity_conflict'; end if;
    insert into public.metadata_fields(id,category_id,field_type) values(field_uuid,category,kind)
      on conflict(id) do nothing;
    perform private.metadata_validate_rules(kind,coalesce(f->'rules','{}'::jsonb));
    if kind='currency' and exists(
      select 1 from public.form_revision_fields prior
      join public.category_form_revisions published on published.id=prior.revision_id
      where prior.field_id=field_uuid and published.status='published'
        and (prior.rules->>'currencyCode' is distinct from f->'rules'->>'currencyCode'
          or prior.rules->>'precision' is distinct from f->'rules'->>'precision')
    ) then raise exception using errcode='P1021',message='currency_meaning_requires_new_field_id'; end if;
    insert into public.form_revision_fields(revision_id,field_id,label,help,applies_to,required,
      default_value,rules,sort_order)
      values(rev,field_uuid,btrim(f->>'label'),nullif(f->>'help',''),
        array(select jsonb_array_elements_text(f->'applies_to')),(f->>'required')::boolean,
        f->'default',coalesce(f->'rules','{}'::jsonb),ordinal);
    row_count:=coalesce(jsonb_array_length(f->'options'),0);
    if row_count>1000 or option_count+row_count>5000 then
      raise exception using errcode='P1022',message='option_resource_limit'; end if;
    if kind not in ('single_select','multi_select','hierarchical_select') and row_count>0 then
      raise exception using errcode='P1021',message='options_on_nonselection'; end if;
    option_count:=option_count+row_count;
    for o in select value from jsonb_array_elements(coalesce(f->'options','[]'::jsonb)) loop
      if jsonb_typeof(o) is distinct from 'object' then
        raise exception using errcode='P1021',message='invalid_option'; end if;
      if not (o ?& array['id','label','active']) or
        exists(select 1 from jsonb_object_keys(o) k where k not in
          ('id','label','parent_id','active')) or
        not coalesce((o->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
        or jsonb_typeof(o->'label') is distinct from 'string'
        or not coalesce(length(btrim(o->>'label')) between 1 and 200,false)
        or jsonb_typeof(o->'active') is distinct from 'boolean' or
        (o ? 'parent_id' and o->'parent_id'<>'null'::jsonb and
          not coalesce((o->>'parent_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)) then
        raise exception using errcode='P1021',message='invalid_option'; end if;
      option_uuid:=(o->>'id')::uuid;
      if exists(select 1 from public.metadata_options where id=option_uuid and field_id<>field_uuid) then
        raise exception using errcode='P1021',message='option_identity_conflict'; end if;
      insert into public.metadata_options(id,field_id) values(option_uuid,field_uuid) on conflict(id) do nothing;
      parent_uuid:=nullif(o->>'parent_id','')::uuid;
      insert into public.form_revision_options(revision_id,field_id,option_id,parent_option_id,label,active,sort_order)
        values(rev,field_uuid,option_uuid,parent_uuid,btrim(o->>'label'),(o->>'active')::boolean,
          (select count(*) from public.form_revision_options where revision_id=rev and field_id=field_uuid));
    end loop;
    -- Reject only fresh publication; historical immutable revisions remain untouched.
    select choice.parent_option_id into parent_uuid from public.form_revision_options choice
      where choice.revision_id=rev and choice.field_id=field_uuid and choice.active
      group by choice.parent_option_id,private.metadata_option_label_key(choice.label) collate "C"
      having count(*)>1 limit 1;
    if found then
      raise exception using errcode='P1021',message='ambiguous_active_sibling_options',
        detail='Field "'||(f->>'label')||'", path '||coalesce(array_to_string(
          private.metadata_option_path(rev,field_uuid,parent_uuid),' / '),'Root choices')||
          ': active siblings need distinguishable labels. Field ID '||field_uuid::text;
    end if;
    if kind<>'hierarchical_select' and exists(select 1 from public.form_revision_options
      where revision_id=rev and field_id=field_uuid and parent_option_id is not null) then
      raise exception using errcode='P1021',message='nonhierarchical_parent'; end if;
    -- Every node must reach a root in at most 64 hops; a cycle cannot pass.
    if kind='hierarchical_select' and exists(
      with recursive walk as (
        select option_id,parent_option_id,array[option_id] visited,1 depth
        from public.form_revision_options where revision_id=rev and field_id=field_uuid
        union all
        select w.option_id,p.parent_option_id,w.visited||p.option_id,w.depth+1
        from walk w join public.form_revision_options p on p.revision_id=rev
          and p.field_id=field_uuid and p.option_id=w.parent_option_id
        where w.parent_option_id is not null and w.depth<65 and not p.option_id=any(w.visited)
      )
      select 1 from walk w where w.depth>64 or
        (w.parent_option_id is not null and (w.parent_option_id=any(w.visited)
          or not exists(select 1 from public.form_revision_options p where p.revision_id=rev
            and p.field_id=field_uuid and p.option_id=w.parent_option_id)))
    ) then raise exception using errcode='P1022',message='option_depth_or_cycle'; end if;
    if f ? 'default' and not private.metadata_value_valid(rev,field_uuid,f->'default') then
      raise exception using errcode='P1021',message='invalid_default'; end if;
    ordinal:=ordinal+1;
  end loop;
  ordinal:=0;
  for s in select value from jsonb_array_elements(definition->'layout') loop
    if jsonb_typeof(s) is distinct from 'object' or
      jsonb_typeof(s->'controls') is distinct from 'array' then
      raise exception using errcode='P1021',message='invalid_section'; end if;
    if not (s ?& array['id','label','controls']) or
      exists(select 1 from jsonb_object_keys(s) k where k not in ('id','label','controls','visible','applies_to')) or
      not coalesce((s->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
      or jsonb_typeof(s->'label') is distinct from 'string'
      or not coalesce(length(btrim(s->>'label')) between 1 and 200,false)
      or coalesce(jsonb_array_length(s->'controls'),0)>200
      or (s ? 'visible' and jsonb_typeof(s->'visible')<>'boolean')
      or (s ? 'applies_to' and (jsonb_typeof(s->'applies_to')<>'array'
        or jsonb_array_length(s->'applies_to') not between 1 and 2)) then
      raise exception using errcode='P1021',message='invalid_section'; end if;
    if s ? 'applies_to' and (exists(select 1 from jsonb_array_elements_text(s->'applies_to') x
        where x not in ('quantity','asset')) or
      (select count(distinct x) from jsonb_array_elements_text(s->'applies_to') x)<>
        jsonb_array_length(s->'applies_to')) then
      raise exception using errcode='P1021',message='invalid_applicability'; end if;
    section_uuid:=(s->>'id')::uuid;
    insert into public.form_revision_sections(revision_id,id,label,sort_order,visible,applies_to)
      values(rev,section_uuid,btrim(s->>'label'),ordinal,
        coalesce((s->>'visible')::boolean,true),
        case when s ? 'applies_to' then array(select jsonb_array_elements_text(s->'applies_to'))
          else array['quantity','asset']::text[] end);
    row_count:=0;
    for c in select value from jsonb_array_elements(s->'controls') loop
      if jsonb_typeof(c) is distinct from 'object' then
        raise exception using errcode='P1021',message='invalid_control'; end if;
      if not (c ?& array['id','kind','width']) or
        exists(select 1 from jsonb_object_keys(c) k where k not in
          ('id','kind','field_id','builtin','help','width','visible','applies_to')) or
        not coalesce((c->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
        or not coalesce(c->>'kind' in ('field','builtin','help'),false)
        or not ((jsonb_typeof(c->'width')='string' and c->>'width'='Auto')
          or (jsonb_typeof(c->'width')='number' and c->>'width' ~ '^(3|4|6|8|9|12)$'))
        or (c ? 'visible' and jsonb_typeof(c->'visible')<>'boolean')
        or (c ? 'applies_to' and (jsonb_typeof(c->'applies_to')<>'array'
          or jsonb_array_length(c->'applies_to') not between 1 and 2)) then
        raise exception using errcode='P1021',message='invalid_control'; end if;
      if c ? 'applies_to' and (exists(select 1 from jsonb_array_elements_text(c->'applies_to') x
          where x not in ('quantity','asset')) or
        (select count(distinct x) from jsonb_array_elements_text(c->'applies_to') x)<>
          jsonb_array_length(c->'applies_to')) then
        raise exception using errcode='P1021',message='invalid_applicability'; end if;
      control_uuid:=(c->>'id')::uuid;
      kind:=c->>'kind';
      if (kind='field' and (not (c ? 'field_id') or c ? 'builtin' or c ? 'help')) or
        (kind='builtin' and (not (c ? 'builtin') or c ? 'field_id' or c ? 'help')) or
        (kind='help' and (not (c ? 'help') or c ? 'field_id' or c ? 'builtin')) then
        raise exception using errcode='P1021',message='invalid_control_properties'; end if;
      if kind='field' and (not coalesce((c->>'field_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) or
        not exists(select 1 from public.form_revision_fields where revision_id=rev
          and field_id=(c->>'field_id')::uuid)) then
        raise exception using errcode='P1021',message='unknown_layout_field'; end if;
      if kind='builtin' and not coalesce(c->>'builtin' in
        ('name','category_id','description','manufacturer','model','item_code',
         'reorder_threshold','asset_tag','serial_number'),false) then
        raise exception using errcode='P1021',message='unsupported_builtin'; end if;
      if kind='help' and (jsonb_typeof(c->'help')<>'string' or length(c->>'help')>2000) then
        raise exception using errcode='P1021',message='invalid_help'; end if;
      insert into public.form_revision_controls(revision_id,section_id,control_id,kind,field_id,builtin,help,width,sort_order,visible,applies_to)
        values(rev,section_uuid,control_uuid,kind,
          case when kind='field' then (c->>'field_id')::uuid end,
          case when kind='builtin' then c->>'builtin' end,
          case when kind='help' then c->>'help' end,c->>'width',row_count,
          coalesce((c->>'visible')::boolean,true),
          case when c ? 'applies_to' then array(select jsonb_array_elements_text(c->'applies_to'))
            else array['quantity','asset']::text[] end);
      row_count:=row_count+1;
    end loop;
    ordinal:=ordinal+1;
  end loop;
  -- Reachability is evaluated per inherent record kind after every ancestor's
  -- visibility and applicability. A required field cannot exist only in a
  -- hidden or wrong-kind section. Protected controls must remain reachable.
  if exists(
    select 1 from (values('quantity'::text,'name'::text),('asset','name'),
      ('quantity','category_id'),('asset','category_id'),('asset','asset_tag')) p(entity_kind,builtin)
    where (select count(*) from public.form_revision_controls c
      join public.form_revision_sections s on s.revision_id=c.revision_id and s.id=c.section_id
      where c.revision_id=rev and c.builtin=p.builtin and c.visible and s.visible
        and p.entity_kind=any(c.applies_to) and p.entity_kind=any(s.applies_to))<>1
  ) or exists(
    select 1 from public.form_revision_fields f, unnest(f.applies_to) entity_kind
    where f.revision_id=rev and f.required and not exists(
      select 1 from public.form_revision_controls c
      join public.form_revision_sections s on s.revision_id=c.revision_id and s.id=c.section_id
      where c.revision_id=rev and c.field_id=f.field_id and c.visible and s.visible
        and entity_kind=any(c.applies_to) and entity_kind=any(s.applies_to))
  ) then raise exception using errcode='P1021',message='required_control_missing'; end if;
exception when unique_violation then
  raise exception using errcode='P1021',message='duplicate_form_identity';
end;
$$;

create or replace function private.metadata_rules_consequential(kind text, before_rules jsonb, after_rules jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare k text; old_value text; new_value text;
begin
  for k in select key from (select jsonb_object_keys(coalesce(before_rules,'{}'::jsonb)) key
    union select jsonb_object_keys(coalesce(after_rules,'{}'::jsonb))) keys loop
    if before_rules->k is not distinct from after_rules->k then continue; end if;
    if kind='boolean' and k='booleanPresentation' then continue; end if;
    old_value:=before_rules->>k; new_value:=after_rules->>k;
    if k in ('maxLength','maxSelections') and old_value ~ '^[0-9]+$'
      and new_value ~ '^[0-9]+$' and new_value::numeric>=old_value::numeric then continue; end if;
    if k='minLength' and old_value ~ '^[0-9]+$'
      and new_value ~ '^[0-9]+$' and new_value::numeric<=old_value::numeric then continue; end if;
    if kind in ('integer','decimal') and k='max' and old_value ~ '^-?[0-9]+(\.[0-9]+)?$'
      and new_value ~ '^-?[0-9]+(\.[0-9]+)?$'
      and new_value::numeric>=old_value::numeric then continue; end if;
    if kind in ('integer','decimal') and k='min' and old_value ~ '^-?[0-9]+(\.[0-9]+)?$'
      and new_value ~ '^-?[0-9]+(\.[0-9]+)?$'
      and new_value::numeric<=old_value::numeric then continue; end if;
    return true;
  end loop;
  return false;
end;
$$;

create function private.metadata_option_paths(rev uuid, field uuid, selected uuid[]) returns jsonb
language plpgsql stable set search_path='' as $$
declare labels jsonb; answer uuid; current_id uuid; node jsonb; path text[];
  paths jsonb:='[]'::jsonb; path_json jsonb; path_bytes integer:=2; option_count integer;
begin
  if selected is null or cardinality(selected)>1000 then
    raise exception using errcode='P1022',message='selection_resource_limit'; end if;
  if cardinality(selected)=0 then return paths; end if;
  select count(*) into option_count from (
    select 1 from public.form_revision_options where revision_id=rev and field_id=field limit 1001
  ) bounded;
  if option_count>1000 then raise exception using errcode='P1022',message='option_resource_limit'; end if;
  -- Each stored label is already bounded to 200 characters. At most 1000 are
  -- normalized once, even when all 1000 answers are requested.
  with keyed as materialized (
    select choice.option_id,choice.parent_option_id,choice.label,choice.active,
      private.metadata_option_label_key(choice.label) collate "C" label_key
    from public.form_revision_options choice where choice.revision_id=rev and choice.field_id=field
  ), counted as (
    select *,count(*) filter(where active) over(partition by parent_option_id,label_key) sibling_count from keyed
  ) select coalesce(jsonb_object_agg(option_id::text,jsonb_build_object(
    'parent',parent_option_id,'label',label || case when active and sibling_count>1
      then ' [choice '||option_id::text||']' else '' end)),'{}'::jsonb)
    into labels from counted;
  foreach answer in array selected loop
    path:=null; current_id:=answer;
    for depth in 1..64 loop
      exit when current_id is null;
      node:=labels->current_id::text;
      exit when node is null;
      path:=array_prepend(node->>'label',path);
      current_id:=(node->>'parent')::uuid;
    end loop;
    if current_id is not null and node is not null then
      raise exception using errcode='P1022',message='option_depth_or_cycle'; end if;
    path_json:=coalesce(to_jsonb(path),'null'::jsonb);
    -- The old complete description boundary is 2096640 bytes. Check before
    -- appending so oversized paths fail explicitly instead of returning partial data.
    path_bytes:=path_bytes+octet_length(path_json::text)+case when jsonb_array_length(paths)>0 then 2 else 0 end;
    if path_bytes>2096640 then
      raise exception using errcode='P1025',message='metadata_description_too_large'; end if;
    paths:=paths||jsonb_build_array(path_json);
  end loop;
  return paths;
end;
$$;
revoke all on function private.metadata_option_paths(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;

-- Preserve the established scalar signature for compiler guidance and callers.
create or replace function private.metadata_option_path(rev uuid, field uuid, selected uuid) returns text[]
language plpgsql stable set search_path='' as $$
declare paths jsonb;
begin
  if selected is null then return null; end if;
  paths:=private.metadata_option_paths(rev,field,array[selected]);
  if paths->0='null'::jsonb then return null; end if;
  return array(select jsonb_array_elements_text(paths->0));
end;
$$;

create or replace function public.metadata_describe_values(p_values jsonb,p_current_category uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); field_key text; entry jsonb; rev uuid; field_uuid uuid;
  cfg public.form_revision_fields%rowtype; kind text; option_id uuid; paths jsonb; choice jsonb;
  result jsonb:='{}'::jsonb; choice_path text[]; path_bytes integer; current_form uuid;
  owner_category uuid; owner_form uuid;
begin
  perform 1 from public.app_members where user_id=actor and active;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  if jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>262144 then
    raise exception using errcode='P1012',message='invalid_custom_envelope'; end if;
  select published_form_revision_id into current_form from public.categories
    where id=p_current_category;
  for field_key,entry in select key,value from jsonb_each(p_values) loop
    if jsonb_typeof(entry) is distinct from 'object' then
      raise exception using errcode='P1012',message='invalid_custom_entry'; end if;
    if field_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or not (entry ?& array['value','validated_revision_id'])
      or (select count(*) from jsonb_object_keys(entry))<>2
      or jsonb_typeof(entry->'validated_revision_id') is distinct from 'string'
      or not coalesce((entry->>'validated_revision_id') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false) then
      raise exception using errcode='P1012',message='invalid_custom_shape'; end if;
    field_uuid:=field_key::uuid; rev:=(entry->>'validated_revision_id')::uuid;
    if field_key<>field_uuid::text or not exists(
      select 1 from public.category_form_revisions where id=rev and status='published'
    ) then raise exception using errcode='P1012',message='invalid_custom_revision'; end if;
    select * into cfg from public.form_revision_fields where revision_id=rev and field_id=field_uuid;
    if not found or not private.metadata_value_valid(rev,field_uuid,entry->'value') then
      raise exception using errcode='P1012',message='invalid_custom_value'; end if;
    select f.field_type,f.category_id,c.published_form_revision_id
      into kind,owner_category,owner_form
      from public.metadata_fields f join public.categories c on c.id=f.category_id
      where f.id=field_uuid;
    paths:='[]'::jsonb;
    path_bytes:=0;
    if kind in ('single_select','hierarchical_select') and jsonb_typeof(entry->'value')='string' then
      option_id:=(entry->>'value')::uuid;
      choice_path:=private.metadata_option_path(rev,field_uuid,option_id);
      path_bytes:=octet_length(to_jsonb(choice_path)::text);
      if path_bytes>2096640 then raise exception using errcode='P1025',message='metadata_description_too_large'; end if;
      paths:=jsonb_build_array(choice_path);
    elsif kind='multi_select' and jsonb_typeof(entry->'value')='array' then
      if jsonb_array_length(entry->'value')>1000 then
        raise exception using errcode='P1022',message='selection_resource_limit'; end if;
      if (select count(distinct x::text) from jsonb_array_elements(entry->'value') x)<>
         jsonb_array_length(entry->'value') then
        raise exception using errcode='P1012',message='duplicate_selected_option'; end if;
      paths:=private.metadata_option_paths(rev,field_uuid,
        array(select (selected_choice.value#>>'{}')::uuid
          from jsonb_array_elements(entry->'value') selected_choice(value)));
    end if;
    result:=result||jsonb_build_object(field_key,jsonb_build_object('value',entry->'value',
      'validated_revision_id',rev,'label',cfg.label,'field_type',kind,'option_paths',paths,
      'category_id',owner_category,'current_published_revision_id',owner_form,
      'legacy',rev is distinct from current_form or not exists(
        select 1 from public.form_revision_fields current_field
          where current_field.revision_id=current_form and current_field.field_id=field_uuid)));
    if octet_length(result::text)>2096640 then
      raise exception using errcode='P1025',message='metadata_description_too_large'; end if;
  end loop;
  return result;
end;
$$;

create or replace function public.metadata_event_custom_page(
  p_kind text,p_event_id uuid,p_side text,p_field_id uuid default null,p_option_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); before_state jsonb; after_state jsonb;
  before_values jsonb; after_values jsonb; all_values jsonb; side_values jsonb;
  selected_field text; next_field text; entry jsonb; source_entry jsonb;
  chosen_revision uuid; field_uuid uuid; field_label text; field_type text;
  owner_category uuid; current_revision uuid; event_category uuid;
  option_value jsonb; option_id uuid; option_path text[]; paths jsonb:='[]'::jsonb;
  option_total integer:=0; next_offset integer; result jsonb;
begin
  perform 1 from public.app_members where user_id=actor and active;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  if p_kind is null or p_kind not in ('quantity','asset') or
    p_side is null or p_side not in ('before','after') or
    p_event_id is null or p_option_offset is null or p_option_offset<0 or
    p_option_offset>1000 or p_option_offset%16<>0 then
    raise exception using errcode='P1012',message='invalid_history_page'; end if;
  if p_kind='quantity' then
    select e.before_metadata,e.after_metadata into before_state,after_state
      from public.quantity_events e where e.id=p_event_id;
  else
    select e.before_metadata,e.after_metadata into before_state,after_state
      from public.asset_events e where e.id=p_event_id;
  end if;
  if not found then raise exception using errcode='P1010',message='not_found'; end if;
  before_values:=coalesce(before_state->'custom_values','{}'::jsonb);
  after_values:=coalesce(after_state->'custom_values','{}'::jsonb);
  if jsonb_typeof(before_values) is distinct from 'object' or
    jsonb_typeof(after_values) is distinct from 'object' or
    octet_length(before_values::text)>262144 or octet_length(after_values::text)>262144 then
    raise exception using errcode='P1012',message='invalid_history_values'; end if;
  all_values:=before_values||after_values;
  if p_field_id is not null and not (all_values ? p_field_id::text) then
    raise exception using errcode='P1012',message='invalid_history_field'; end if;
  select min(key) into selected_field from jsonb_object_keys(all_values) key
    where p_field_id is null or key=p_field_id::text;
  if selected_field is null then
    if p_option_offset<>0 then raise exception using errcode='P1012',message='invalid_history_offset'; end if;
    return jsonb_build_object('event_id',p_event_id,'kind',p_kind,'side',p_side,
      'field_id',null,'next_field_id',null,'present',false,'option_paths','[]'::jsonb,
      'next_option_offset',null);
  end if;
  if selected_field !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='P1012',message='invalid_history_field'; end if;
  select min(key) into next_field from jsonb_object_keys(all_values) key where key>selected_field;
  field_uuid:=selected_field::uuid;
  side_values:=case when p_side='before' then before_values else after_values end;
  entry:=side_values->selected_field;
  source_entry:=coalesce(entry,all_values->selected_field);
  if jsonb_typeof(source_entry) is distinct from 'object' or
    jsonb_typeof(source_entry->'validated_revision_id') is distinct from 'string' or
    (source_entry->>'validated_revision_id') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='P1012',message='invalid_history_provenance'; end if;
  chosen_revision:=(source_entry->>'validated_revision_id')::uuid;
  select f.label,m.field_type,m.category_id,c.published_form_revision_id
    into field_label,field_type,owner_category,current_revision
    from public.form_revision_fields f join public.metadata_fields m on m.id=f.field_id
    join public.categories c on c.id=m.category_id
    where f.revision_id=chosen_revision and f.field_id=field_uuid;
  if not found then raise exception using errcode='P1012',message='invalid_history_provenance'; end if;
  event_category:=nullif((case when p_side='before' then before_state else after_state end)->>'category_id','')::uuid;
  if entry is not null then
    if entry->>'validated_revision_id'<>chosen_revision::text or
      not private.metadata_value_valid(chosen_revision,field_uuid,entry->'value') then
      raise exception using errcode='P1012',message='invalid_history_value'; end if;
    if field_type='multi_select' then
      option_total:=jsonb_array_length(entry->'value');
      if option_total>1000 then raise exception using errcode='P1022',message='selection_resource_limit'; end if;
      if p_option_offset>0 and p_option_offset>=option_total then
        raise exception using errcode='P1012',message='invalid_history_offset'; end if;
      -- Preserve the existing 16-path page, not a limit on stored answers.
      paths:=private.metadata_option_paths(chosen_revision,field_uuid,array(
        select (v.value#>>'{}')::uuid from jsonb_array_elements(entry->'value')
          with ordinality as v(value,position) where v.position>p_option_offset
          order by v.position limit 16));
      if octet_length(paths::text)>1500000 then
        raise exception using errcode='P1025',message='metadata_history_page_too_large'; end if;
      if option_total>p_option_offset+16 then next_offset:=p_option_offset+16; end if;
    elsif field_type in ('single_select','hierarchical_select') then
      if p_option_offset<>0 then raise exception using errcode='P1012',message='invalid_history_offset'; end if;
      option_id:=(entry->>'value')::uuid;
      paths:=jsonb_build_array(private.metadata_option_path(chosen_revision,field_uuid,option_id));
    elsif p_option_offset<>0 then
      raise exception using errcode='P1012',message='invalid_history_offset';
    end if;
  elsif p_option_offset<>0 then
    raise exception using errcode='P1012',message='invalid_history_offset';
  end if;
  result:=jsonb_build_object('event_id',p_event_id,'kind',p_kind,'side',p_side,
    'field_id',field_uuid,'next_field_id',next_field,'present',entry is not null,
    'value',entry->'value','validated_revision_id',entry->>'validated_revision_id',
    'label',field_label,'field_type',field_type,'owner_category_id',owner_category,
    'event_category_id',event_category,'current_published_revision_id',current_revision,
    'legacy',owner_category is distinct from event_category or
      chosen_revision is distinct from current_revision or
      not exists(select 1 from public.form_revision_fields current_field
        where current_field.revision_id=current_revision and current_field.field_id=field_uuid),
    'option_paths',paths,'option_offset',p_option_offset,'next_option_offset',next_offset);
  if octet_length(result::text)>2096640 then
    raise exception using errcode='P1025',message='metadata_history_page_too_large'; end if;
  return result;
end;
$$;
