const TOOLTIP_LINES = buildTooltipLines()

function buildTooltipLines(): string[] {
  return [
    'Allowed characters:',
    '',
    'A B C D E F G H I J K L M N O P',
    'Q R S T U V W X Y Z Å Ä Ö Ü Ø ø',
    '',
    'a b c d e f g h i j k l m n o p',
    'q r s t u v w x y z å ä ö ü',
    '',
    '0 1 2 3 4 5 6 7 8 9 # & \' . _',
    '+ - = $ ( ) , > ! % £ ¢',
    '',
    '; [ ] ^ { | }',
    '¡ × ¥ ¤ ¦ ¨ © « ¬ ® ¯ ° ± ² ³',
    '´ µ ¶ · ¸ ¹ º » ¼ ½ ¾ ¿',
    'À Á Â Ã Ä Å Æ Ç È É Ê Ë Ì Í Î Ï',
    'Ð Ñ Ò Ó Ô Õ Ö Ù Ú Û Ü Ý Þ ß',
    'à á â ã ä å æ ç è é ê ë ì í î ï',
    'ð ñ ò ó ô õ ö ø ù ú û ü ý þ ÿ',
  ]
}

export function CharsetInfoIcon() {
  return (
    <span className="charset-info-wrapper">
      <i className="fas fa-circle-info charset-info-icon"></i>
      <div className="charset-tooltip">
        {TOOLTIP_LINES.map((line, i) => (
          <div key={i}>{line || ' '}</div>
        ))}
      </div>
    </span>
  )
}
