const TOOLTIP_TEXT = buildTooltipText()

function buildTooltipText(): string {

  // Reproduce OT page layout, skipping FS-forbidden chars
  const rows = [
    // Page 1 - Row 1 & 2: uppercase + Nordic
    'A B C D E F G H I J K L M N O P',
    'Q R S T U V W X Y Z Å Ä Ö Ü Ø ø',
    '',
    // Page 1 - Row 3 & 4: lowercase + Nordic
    'a b c d e f g h i j k l m n o p',
    'q r s t u v w x y z å ä ö ü',
    '',
    // Page 1 - Row 5: digits + safe symbols
    '0 1 2 3 4 5 6 7 8 9 # & \' . _',
    // Page 1 - Row 6: operators (minus FS-forbidden)
    '+ - = $ ( ) , > ! % £ ¢',
    '',
    // Page 2: extended (minus FS-forbidden)
    '; [ ] ^ { | }',
    '¡ × ¥ ¤ ¦ ¨ © « ¬ ® ¯ ° ± ² ³',
    '´ µ ¶ · ¸ ¹ º » ¼ ½ ¾ ¿',
    'À Á Â Ã Ä Å Æ Ç È É Ê Ë Ì Í Î Ï',
    'Ð Ñ Ò Ó Ô Õ Ö Ù Ú Û Ü Ý Þ ß',
    'à á â ã ä å æ ç è é ê ë ì í î ï',
    'ð ñ ò ó ô õ ö ø ù ú û ü ý þ ÿ',
  ]

  return rows.join('\n')
}

export function CharsetInfoIcon() {
  return (
    <i
      className="fas fa-circle-info charset-info-icon"
      title={TOOLTIP_TEXT}
    ></i>
  )
}
