import React, { useState } from 'react';

function detectarGerencia(linhas) {
  for (const linha of linhas) {
    const l = linha.toLowerCase();

    if (l.includes('pon port:') && l.includes('.lt') && l.includes('.pon')) return 'PRIMARIA_CSV';
    if (l.includes('ont:') && l.includes('.lt') && l.includes('.pon')) return 'AMS';
    if (l.includes('ethernet lt port:')) return 'AMS_SFP';
    if (l.includes('frame=') && l.includes('slot=') && l.includes('port=')) return 'IMASTER';
    if (l.includes('onuid')) return 'IMASTER';
    if (l.includes('zte') || l.includes('com.zte')) return 'ZTE';

    if (
      linha.includes('\t') &&
      (
        l.includes('off line') ||
        l.includes('link loss') ||
        l.includes('link_loss') ||
        l.includes('/gcob[') ||
        l.includes('/pon')
      )
    ) {
      return 'UNM2000';
    }
  }

  return 'IMASTER';
}

function formatarData(dataTexto) {
  if (!dataTexto) return '';

  const match = dataTexto.match(
    /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/
  );

  if (!match) return '';

  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
}

function gerarTicketsTexto(gerencia, linhas) {
  let resultadoFinal = '';

  if (gerencia === 'UNM2000') {
    const agrupado = {};
    const primarias = [];

    linhas.forEach((linha) => {
      // PRIMÁRIA
      const matchPrimaria = linha.match(
        /([A-Z0-9\-]+)\/GCOB\[(\d+)\]\/PON(\d+)\s*$/i
      );

      if (matchPrimaria) {
        const colunas = linha.split('\t');
        const data = formatarData(colunas[16] || '');

        primarias.push({
          olt: `OLT1-PR-${matchPrimaria[1]}`,
          slot: matchPrimaria[2],
          port: matchPrimaria[3],
          data
        });
        return;
      }

      // SECUNDÁRIA NOVA
      const matchNovo = linha.match(
        /([A-Z0-9\-]+)\/GCOB\[(\d+)\]\/PON(\d+)\/(\d+)[^:]*:\[(\d+)\]/i
      );

      if (matchNovo) {
        const colunas = linha.split('\t');
        const data = formatarData(colunas[16] || '');

        const olt = `OLT1-PR-${matchNovo[1]}`;
        const slot = matchNovo[2];
        const port = matchNovo[3];
        const contrato = matchNovo[4];
        const onu = matchNovo[5];

        const chave = `${olt}-${slot}-${port}`;

        if (!agrupado[chave]) {
          agrupado[chave] = {
            olt,
            slot,
            port,
            data,
            clientes: []
          };
        }

        agrupado[chave].clientes.push({ onu, contrato });
        return;
      }

      // FORMATO ANTIGO
      const colunas = linha.split('\t');
      if (colunas.length < 6) return;

      const cliente = colunas[1] || '';
      let contrato = cliente;

      if (cliente.includes('_')) contrato = cliente.split('_')[0];
      else if (cliente.includes(' ')) contrato = cliente.split(' ')[0];

      const slot = colunas[3];
      const port = colunas[4];
      const onu = colunas[5];
      const data = formatarData(colunas[16] || '');

      const olt = 'OLT-UNM';
      const chave = `${olt}-${slot}-${port}`;

      if (!agrupado[chave]) {
        agrupado[chave] = {
          olt,
          slot,
          port,
          data,
          clientes: []
        };
      }

      agrupado[chave].clientes.push({ onu, contrato });
    });

    // SAÍDA PRIMÁRIA
    primarias.forEach((p) => {
      resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha:  Sercomtel - Primaria :${p.olt} - ${p.slot}/${p.port} - Circuitos Afetados:  
Hora/data: 
Alarme: LOSS
IP: N/A
Interface: ${p.olt} - ${p.slot}/${p.port} - Primaria 

Interface: ${p.slot}/${p.port}

\n`;
    });

    // SAÍDA SECUNDÁRIA
    Object.values(agrupado).forEach((grupo) => {
      resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha:  - Sercomtel - Secundaria :${grupo.olt}- ${grupo.slot}/${grupo.port} - Circuitos Afetados: 
Hora/data: ${grupo.data}
Alarme: LOSS
IP: N/A
Interface:${grupo.olt}- ${grupo.slot}/${grupo.port} - Secundaria

`;

      grupo.clientes
        .sort((a, b) => Number(a.onu) - Number(b.onu))
        .forEach((cliente) => {
          resultadoFinal += `ONU ${cliente.onu} - Contrato ${cliente.contrato}\n`;
        });

      resultadoFinal += '\n';
    });

    return resultadoFinal.trim();
  }

  return 'Nenhum alarme reconhecido.';
}

function processarTexto(texto) {
  const linhas = texto.split('\n').filter(Boolean);
  const gerencia = detectarGerencia(linhas);
  return gerarTicketsTexto(gerencia, linhas);
}

export default function App() {
  const [entrada, setEntrada] = useState('');
  const [resultado, setResultado] = useState('');

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial', maxWidth: '1000px', margin: '0 auto' }}>
      <h1>🔧 Parser UNM2000</h1>

      <textarea
        value={entrada}
        onChange={(e) => setEntrada(e.target.value)}
        placeholder="Cole os alarmes aqui..."
        style={{
          width: '100%',
          height: '250px',
          padding: '10px',
          marginBottom: '10px'
        }}
      />

      <div style={{ marginBottom: '10px' }}>
        <button
          onClick={() => setResultado(processarTexto(entrada))}
          style={{ marginRight: '10px', padding: '10px 20px' }}
        >
          Gerar Alarme
        </button>

        <button
          onClick={() => {
            setEntrada('');
            setResultado('');
          }}
          style={{ padding: '10px 20px' }}
        >
          Limpar
        </button>
      </div>

      <textarea
        value={resultado}
        readOnly
        style={{
          width: '100%',
          height: '300px',
          padding: '10px'
        }}
      />
    </div>
  );
}
