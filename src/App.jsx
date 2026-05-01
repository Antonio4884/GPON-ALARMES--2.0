import React, { useState } from 'react';

function detectarGerencia(linhas) {
  for (const linha of linhas) {
    const l = linha.toLowerCase();

    if (l.includes('pon port:') && l.includes('.lt') && l.includes('.pon')) {
      return 'PRIMARIA_CSV';
    }

    if (l.includes('ont:') && l.includes('.lt') && l.includes('.pon')) {
      return 'AMS';
    }

    if (l.includes('ethernet lt port:')) {
      return 'AMS_SFP';
    }

    if (l.includes('frame=') && l.includes('slot=') && l.includes('port=')) {
      return 'IMASTER';
    }

    if (l.includes('onuid')) {
      return 'IMASTER';
    }

    if (l.includes('zte') || l.includes('com.zte')) {
      return 'ZTE';
    }

    if (
      linha.includes('\t') &&
      (l.includes('off line') || l.includes('link loss'))
    ) {
      return 'UNM2000';
    }
  }

  return 'IMASTER';
}

function extrairPrimariaCsv(linhas) {
  return linhas
    .map((linha) => {
      const match = linha.match(/PON Port:([^,]+)/i);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .join('\n');
}

function extrairOntsAms(linhas) {
  return linhas
    .map((linha) => {
      const match = linha.match(/ONT:[^,\s]+/);
      return match ? match[0] : null;
    })
    .filter(Boolean)
    .join('\n');
}

function extrairSfpAms(linhas) {
  return linhas
    .map((linha) => {
      const match = linha.match(/Ethernet LT Port:([^,]+,SFP)/);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .join('\n');
}

function gerarTicketsTexto(gerencia, linhas) {
  const data = new Date().toLocaleString('pt-BR');

  const falhaPrimaria = linhas.some((linha) =>
    linha.toLowerCase().includes('the feeder fiber is broken')
  );

  if (falhaPrimaria) {
    return `-:CARIMBO DE ABERTURA - NOC:-.
Falha primária detectada
Hora/data: ${data}`;
  }

  return `-:CARIMBO DE ABERTURA - NOC:-.
Gerência detectada: ${gerencia}
Hora/data: ${data}

${linhas.join('\n')}`;
}

function processarTexto(texto) {
  const linhas = texto.split('\n').filter(Boolean);
  const gerencia = detectarGerencia(linhas);

  if (gerencia === 'AMS') return extrairOntsAms(linhas);
  if (gerencia === 'AMS_SFP') return extrairSfpAms(linhas);
  if (gerencia === 'PRIMARIA_CSV') return extrairPrimariaCsv(linhas);

  return gerarTicketsTexto(gerencia, linhas);
}

export default function App() {
  const [entrada, setEntrada] = useState('');
  const [resultado, setResultado] = useState('');

  return (
    <div
      style={{
        padding: '20px',
        fontFamily: 'Arial',
        maxWidth: '1000px',
        margin: '0 auto',
      }}
    >
      <h1>🔧 Huawei, UNM2000, AMS5520 e ZTE</h1>

      <textarea
        value={entrada}
        onChange={(e) => setEntrada(e.target.value)}
        placeholder="Cole os alarmes aqui..."
        style={{
          width: '100%',
          height: '250px',
          padding: '10px',
          marginBottom: '10px',
        }}
      />

      <div style={{ marginBottom: '10px' }}>
        <button
          onClick={() => setResultado(processarTexto(entrada))}
          style={{
            marginRight: '10px',
            padding: '10px 20px',
          }}
        >
          Gerar Alarme
        </button>

        <button
          onClick={() => {
            setEntrada('');
            setResultado('');
          }}
          style={{
            padding: '10px 20px',
          }}
        >
          Limpar
        </button>
      </div>

      <textarea
        value={resultado}
        readOnly
        placeholder="Resultado aparecerá aqui..."
        style={{
          width: '100%',
          height: '250px',
          padding: '10px',
        }}
      />
    </div>
  );
}
